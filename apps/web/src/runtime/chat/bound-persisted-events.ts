/**
 * Browser-side twin of the daemon's per-event storage budget
 * (`apps/daemon/src/runtimes/run-event-payload-budget.ts`).
 *
 * The SSE stream is not size-capped, so a screenshot-heavy turn leaves
 * multi-MB base64 in the browser's copy of a `tool_result`. The daemon bounds
 * every event it STORES (64 KiB per event, 16 KiB per shortened string) but
 * the browser autosave PUT used to send the full copy and trip the global JSON
 * body limit (413) over and over. This shortens only what is sent — the
 * rendered in-memory message is untouched — with the same budgets and the same
 * `truncated: { originalBytes }` field, so what the daemon stores and what the
 * UI reloads look alike. The daemon bounds again on write; both are idempotent.
 *
 * Web may not import daemon source, and the daemon helper needs node:crypto /
 * Buffer, hence this small pure twin (digest is FNV-1a, not sha256).
 */
import type { ChatMessage } from '../../types';

export const PERSIST_EVENT_JSON_BUDGET_BYTES = 64 * 1024;
export const PERSIST_EVENT_STRING_BUDGET_BYTES = 16 * 1024;
const MIN_STRING_BYTES = 256;
const MAX_WALK_DEPTH = 64;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function utf8Bytes(value: string): number {
  return encoder.encode(value).length;
}

function digest(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0').slice(0, 4);
}

function marker(originalBytes: number, omittedBytes: number, hash: string): string {
  return `\n…[open-design: truncated ${omittedBytes} of ${originalBytes} bytes, fnv ${hash}]…\n`;
}

function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

/** Head + marker + tail of `value`, at most `budgetBytes` UTF-8 bytes. */
export function truncateTextToUtf8Budget(value: string, budgetBytes: number): string {
  // Cheap bracket first: a UTF-16 unit is at most 3 bytes.
  if (value.length * 3 <= budgetBytes) return value;
  const bytes = encoder.encode(value);
  if (bytes.length <= budgetBytes) return value;
  const hash = digest(value);
  const reserve = utf8Bytes(marker(bytes.length, bytes.length, hash));
  const keep = Math.max(0, budgetBytes - reserve);
  let headEnd = Math.ceil(keep / 2);
  while (headEnd > 0 && isContinuation(bytes[headEnd])) headEnd -= 1;
  let tailStart = bytes.length - (keep - Math.ceil(keep / 2));
  while (tailStart < bytes.length && isContinuation(bytes[tailStart])) tailStart += 1;
  if (tailStart < headEnd) tailStart = headEnd;
  return (
    decoder.decode(bytes.subarray(0, headEnd))
    + marker(bytes.length, tailStart - headEnd, hash)
    + decoder.decode(bytes.subarray(tailStart))
  );
}

function capStringLeaves(value: unknown, budget: number, depth = 0): unknown {
  if (typeof value === 'string') return truncateTextToUtf8Budget(value, budget);
  if (depth >= MAX_WALK_DEPTH) return value;
  if (Array.isArray(value)) {
    let copy: unknown[] | null = null;
    for (let i = 0; i < value.length; i += 1) {
      const next = capStringLeaves(value[i], budget, depth + 1);
      if (next !== value[i]) {
        copy ??= value.slice();
        copy[i] = next;
      }
    }
    return copy ?? value;
  }
  if (isRecord(value)) {
    let copy: JsonRecord | null = null;
    for (const [key, entry] of Object.entries(value)) {
      const next = capStringLeaves(entry, budget, depth + 1);
      if (next !== entry) {
        copy ??= { ...value };
        copy[key] = next;
      }
    }
    return copy ?? value;
  }
  return value;
}

function* budgets(): Generator<number> {
  for (let b = PERSIST_EVENT_STRING_BUDGET_BYTES; b >= MIN_STRING_BYTES; b = Math.floor(b / 2)) {
    yield b;
  }
}

function fits(event: unknown): boolean {
  const json = JSON.stringify(event) ?? 'null';
  if (json.length * 3 <= PERSIST_EVENT_JSON_BUDGET_BYTES) return true;
  if (json.length > PERSIST_EVENT_JSON_BUDGET_BYTES) return false;
  return utf8Bytes(json) <= PERSIST_EVENT_JSON_BUDGET_BYTES;
}

function withTruncation(event: JsonRecord, originalBytes: number): JsonRecord {
  const previous = isRecord(event.truncated) && typeof event.truncated.originalBytes === 'number'
    ? event.truncated.originalBytes
    : 0;
  return { ...event, truncated: { originalBytes: Math.max(previous, originalBytes) } };
}

function summarize(event: JsonRecord, originalBytes: number): JsonRecord {
  const summary: JsonRecord = { kind: event.kind };
  for (const [key, entry] of Object.entries(event)) {
    if (key === 'kind') continue;
    if (
      (typeof entry === 'string' && entry.length <= 1024)
      || typeof entry === 'number'
      || typeof entry === 'boolean'
      || entry === null
    ) {
      summary[key] = entry;
    }
  }
  return withTruncation(summary, originalBytes);
}

/**
 * `event` as it may be persisted: same reference when it fits or is
 * `text`/`thinking` (the transcript itself, never shortened); otherwise a copy
 * whose payload is shortened until it fits the per-event budget.
 */
export function boundPersistedEvent<T>(event: T): T {
  if (!isRecord(event)) return event;
  if (event.kind === 'text' || event.kind === 'thinking') return event;
  if (fits(event)) return event;
  const originalBytes = utf8Bytes(JSON.stringify(event) ?? '');
  try {
    for (const b of budgets()) {
      let candidate: JsonRecord;
      if (event.kind === 'tool_result') {
        const content = typeof event.content === 'string' ? event.content : String(event.content ?? '');
        candidate = withTruncation(
          { ...event, content: truncateTextToUtf8Budget(content, b) },
          utf8Bytes(content),
        );
      } else {
        candidate = withTruncation(capStringLeaves(event, b) as JsonRecord, originalBytes);
      }
      if (fits(candidate)) return candidate as T;
    }
  } catch {
    // fall through to the summary
  }
  return summarize(event, originalBytes) as T;
}

/** The message with every oversized event shortened; the same object when none was. */
export function boundMessageForPersist(message: ChatMessage): ChatMessage {
  const events = message.events;
  if (!events || events.length === 0) return message;
  let copy: typeof events | null = null;
  for (let i = 0; i < events.length; i += 1) {
    const original = events[i] as (typeof events)[number];
    const bounded = boundPersistedEvent(original);
    if (bounded !== original) {
      copy ??= events.slice();
      copy[i] = bounded;
    }
  }
  return copy ? { ...message, events: copy } : message;
}
