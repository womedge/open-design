import type { UsageTokens } from '@open-design/contracts';

/**
 * Per-assistant-message token capture for Claude's stream-json output, kept
 * out of the existing event stream so no SSE/contract shape changes.
 *
 * What the wire gives us (verified against
 * tests/fixtures/claude-cli-recordings, Claude Code 2.1.259):
 *   - every `assistant` frame repeats the message's `usage`, but its
 *     `output_tokens` is the value at message START (e.g. 4), not the final;
 *   - the final output count only arrives on `stream_event` -> `message_delta`
 *     `usage.output_tokens` (needs --include-partial-messages);
 *   - `message.model` is the concrete model id and the top-level `request_id`
 *     sits on the assistant frame;
 *   - `cache_creation.ephemeral_5m/1h_input_tokens` split the cache writes;
 *   - forwarded Task sub-agent frames carry `parent_tool_use_id` and have no
 *     message_delta, so their output stays at the start value (known
 *     under-count; the per-user-turn `result` frame does not include them).
 *
 * Rules re-implemented from ccusage v20.0.32 (MIT): duplicates of one message
 * resolve to the MAX per field; when `cache_creation` is absent all cache
 * writes are 5-minute writes ("absent is not zero").
 *
 * Without --include-partial-messages there is no message_delta at all; the
 * turn's `result.usage.output_tokens` is then the only exact output figure, so
 * at `result` any shortfall against the sum of the main-turn messages is added
 * to the last message that never got a final count.
 */

export interface ClaudeMessageUsage {
  /** Provider message id (`msg_…`); 1:1 with a request. */
  messageId: string;
  requestId: string | null;
  model: string;
  ts: number;
  tokens: UsageTokens;
  speed: string | null;
  sidechain: boolean;
}

interface MessageState {
  id: string;
  requestId: string | null;
  model: string | null;
  ts: number;
  sidechain: boolean;
  input: number;
  cacheRead: number;
  cacheCreationTotal: number;
  w5: number;
  w1: number;
  hasSplit: boolean;
  output: number;
  finalOutput: boolean;
  speed: string | null;
  emittedSignature: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export function createClaudeMessageUsageCollector(
  onMessage: (m: ClaudeMessageUsage) => void,
  now: () => number = () => Date.now(),
) {
  const states = new Map<string, MessageState>();
  let currentMainStreamId: string | null = null;
  let turnMainIds: string[] = [];

  function stateFor(id: string, obj: Record<string, unknown>, ts?: unknown): MessageState {
    let st = states.get(id);
    if (!st) {
      const parsed = typeof ts === 'string' ? Date.parse(ts) : Number.NaN;
      st = {
        id,
        requestId: null,
        model: null,
        ts: Number.isFinite(parsed) ? parsed : now(),
        sidechain: obj.parent_tool_use_id != null,
        input: 0,
        cacheRead: 0,
        cacheCreationTotal: 0,
        w5: 0,
        w1: 0,
        hasSplit: false,
        output: 0,
        finalOutput: false,
        speed: null,
        emittedSignature: '',
      };
      states.set(id, st);
      if (!st.sidechain) turnMainIds.push(id);
    } else if (obj.parent_tool_use_id == null) {
      // Non-sidechain beats sidechain (ccusage).
      if (st.sidechain) {
        st.sidechain = false;
        if (!turnMainIds.includes(id)) turnMainIds.push(id);
      }
    }
    return st;
  }

  function ingestUsage(st: MessageState, usage: unknown, final: boolean): void {
    if (!isRecord(usage)) return;
    st.input = Math.max(st.input, num(usage.input_tokens));
    st.cacheRead = Math.max(st.cacheRead, num(usage.cache_read_input_tokens));
    st.cacheCreationTotal = Math.max(st.cacheCreationTotal, num(usage.cache_creation_input_tokens));
    if (isRecord(usage.cache_creation)) {
      st.hasSplit = true;
      st.w5 = Math.max(st.w5, num(usage.cache_creation.ephemeral_5m_input_tokens));
      st.w1 = Math.max(st.w1, num(usage.cache_creation.ephemeral_1h_input_tokens));
    }
    const out = num(usage.output_tokens);
    if (final) {
      st.output = Math.max(st.output, out);
      st.finalOutput = true;
    } else {
      st.output = Math.max(st.output, out);
    }
    if (typeof usage.speed === 'string' && usage.speed) st.speed = usage.speed;
  }

  function tokensOf(st: MessageState): UsageTokens {
    let w5: number;
    let w1: number;
    if (st.hasSplit) {
      w5 = st.w5;
      w1 = st.w1;
      // Never let the split lose tokens the total reports.
      if (w5 + w1 < st.cacheCreationTotal) w5 += st.cacheCreationTotal - (w5 + w1);
    } else {
      w5 = st.cacheCreationTotal;
      w1 = 0;
    }
    return { input: st.input, cacheWrite5m: w5, cacheWrite1h: w1, cacheRead: st.cacheRead, output: st.output };
  }

  function emit(st: MessageState): void {
    if (!st.model || st.model.startsWith('<')) return; // `<synthetic>` placeholders
    const tokens = tokensOf(st);
    const total = tokens.input + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead + tokens.output;
    if (total <= 0) return;
    const sig = `${tokens.input}/${tokens.cacheWrite5m}/${tokens.cacheWrite1h}/${tokens.cacheRead}/${tokens.output}/${st.model}/${st.speed ?? ''}`;
    if (sig === st.emittedSignature) return;
    st.emittedSignature = sig;
    onMessage({
      messageId: st.id,
      requestId: st.requestId,
      model: st.model,
      ts: st.ts,
      tokens,
      speed: st.speed,
      sidechain: st.sidechain,
    });
  }

  function flushAll(): void {
    for (const st of states.values()) emit(st);
  }

  function observe(obj: Record<string, unknown>): void {
    if (obj.type === 'stream_event' && isRecord(obj.event)) {
      const ev = obj.event;
      if (ev.type === 'message_start' && isRecord(ev.message) && typeof ev.message.id === 'string') {
        const st = stateFor(ev.message.id, obj, obj.timestamp);
        if (typeof ev.message.model === 'string' && ev.message.model) st.model = ev.message.model;
        ingestUsage(st, ev.message.usage, false);
        if (obj.parent_tool_use_id == null) currentMainStreamId = st.id;
        return;
      }
      if (ev.type === 'message_delta' && obj.parent_tool_use_id == null && currentMainStreamId) {
        const st = states.get(currentMainStreamId);
        if (st) {
          ingestUsage(st, ev.usage, true);
          emit(st);
        }
      }
      return;
    }
    if (obj.type === 'assistant' && isRecord(obj.message) && typeof obj.message.id === 'string') {
      const st = stateFor(obj.message.id, obj, obj.timestamp);
      if (typeof obj.message.model === 'string' && obj.message.model) st.model = obj.message.model;
      if (typeof obj.request_id === 'string' && obj.request_id) st.requestId = obj.request_id;
      ingestUsage(st, obj.message.usage, false);
      return;
    }
    if (obj.type === 'result') {
      const usage = isRecord(obj.usage) ? obj.usage : null;
      const resultOutput = usage ? num(usage.output_tokens) : 0;
      const turn = turnMainIds.map((id) => states.get(id)).filter((s): s is MessageState => !!s);
      const lacking = turn.filter((s) => !s.finalOutput);
      if (lacking.length > 0 && resultOutput > 0) {
        const sum = turn.reduce((a, s) => a + s.output, 0);
        if (resultOutput > sum) lacking[lacking.length - 1]!.output += resultOutput - sum;
      }
      turnMainIds = [];
      flushAll();
    }
  }

  return { observe, flush: flushAll };
}
