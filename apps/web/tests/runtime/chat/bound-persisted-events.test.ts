import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../src/types';
import {
  PERSIST_EVENT_JSON_BUDGET_BYTES,
  boundMessageForPersist,
  boundPersistedEvent,
} from '../../../src/runtime/chat/bound-persisted-events';

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
const b64 = (n: number) => 'iVBORw0KGgo'.repeat(Math.ceil(n / 11)).slice(0, n);

describe('boundPersistedEvent', () => {
  it('truncates a base64 screenshot tool_result with the daemon marker shape', () => {
    const content = JSON.stringify([{ type: 'image', source: { type: 'base64', data: b64(2_000_000) } }]);
    const ev = { kind: 'tool_result', toolUseId: 't1', content, isError: false } as const;
    const out = boundPersistedEvent(ev) as unknown as { toolUseId: string; isError: boolean; content: string; truncated?: unknown };
    expect(out).not.toBe(ev);
    expect(bytes(out)).toBeLessThanOrEqual(PERSIST_EVENT_JSON_BUDGET_BYTES);
    expect(out.toolUseId).toBe('t1');
    expect(out.isError).toBe(false);
    expect(out.truncated).toEqual({ originalBytes: content.length });
    expect(out.content).toContain('[open-design: truncated');
  });

  it('leaves small events and text/thinking untouched (same reference)', () => {
    const small = { kind: 'tool_result', toolUseId: 't', content: 'ok', isError: false } as const;
    expect(boundPersistedEvent(small)).toBe(small);
    const text = { kind: 'text', text: 'x'.repeat(500_000) } as const;
    expect(boundPersistedEvent(text)).toBe(text);
  });

  it('caps long strings in tool_use input', () => {
    const ev = { kind: 'tool_use', id: 'u', name: 'Write', input: { file_path: 'a.html', content: 'y'.repeat(300_000) } } as const;
    const out = boundPersistedEvent(ev) as typeof ev & { truncated?: unknown };
    expect(bytes(out)).toBeLessThanOrEqual(PERSIST_EVENT_JSON_BUDGET_BYTES);
    expect(out.input.file_path).toBe('a.html');
    expect(out.truncated).toBeDefined();
  });
});

describe('boundMessageForPersist', () => {
  it('shrinks a 7 MB message to well under the body limit without mutating the input', () => {
    const events = Array.from({ length: 30 }, (_, i) => ({
      kind: 'tool_result', toolUseId: `t${i}`, content: b64(250_000), isError: false,
    }));
    const msg = { id: 'm', role: 'assistant', content: 'hi', events } as unknown as ChatMessage;
    const out = boundMessageForPersist(msg);
    expect(JSON.stringify(out).length).toBeLessThan(3.5 * 1024 * 1024);
    expect(JSON.stringify(out).length).toBeLessThan(30 * PERSIST_EVENT_JSON_BUDGET_BYTES);
    expect(out.events).toHaveLength(30);
    expect((msg.events![0] as { content: string }).content.length).toBe(250_000);
  });

  it('returns the same message when nothing is oversized', () => {
    const msg = { id: 'm', role: 'assistant', content: 'hi', events: [{ kind: 'text', text: 'a' }] } as unknown as ChatMessage;
    expect(boundMessageForPersist(msg)).toBe(msg);
  });
});
