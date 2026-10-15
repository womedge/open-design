import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createClaudeStreamHandler } from '../../src/runtimes/claude-stream.js';
import { createClaudeMessageUsageCollector, type ClaudeMessageUsage } from '../../src/usage/claude-message-usage.js';

const REC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/claude-cli-recordings');

function replay(file: string): ClaudeMessageUsage[] {
  const out: ClaudeMessageUsage[] = [];
  const handler = createClaudeStreamHandler(() => {}, { onMessageUsage: (m) => out.push(m) });
  handler.feed(fs.readFileSync(path.join(REC, file), 'utf8'));
  handler.flush();
  return out;
}

describe('Claude per-message usage from recorded CLI output', () => {
  it('takes the FINAL output from message_delta, one record per message', () => {
    const msgs = replay('claude-2.1.259-partial-two-turns.jsonl');
    expect(msgs.map((m) => m.tokens.output)).toEqual([414, 45, 101]);
    expect(msgs).toHaveLength(3); // each message appears in 2 assistant frames; still one record
    expect(msgs[0]!.model).toBe('claude-haiku-4-5-20251001');
    expect(msgs[0]!.requestId).toMatch(/^req_/);
    expect(msgs[0]!.messageId).toMatch(/^msg_/);
  });

  it('reads the 5m/1h cache split and cache reads', () => {
    const [first] = replay('claude-2.1.259-partial-two-turns.jsonl');
    expect(first!.tokens).toEqual({
      input: 10,
      cacheWrite5m: 0,
      cacheWrite1h: 4923,
      cacheRead: 17913,
      output: 414,
    });
  });

  it('per-user-turn result sums reconcile with the per-message records', () => {
    const msgs = replay('claude-2.1.259-partial-two-turns.jsonl');
    // Turn 1 = first two messages (result.usage: input 18, output 459).
    const turn1 = msgs.slice(0, 2);
    expect(turn1.reduce((a, m) => a + m.tokens.input, 0)).toBe(18);
    expect(turn1.reduce((a, m) => a + m.tokens.output, 0)).toBe(459);
  });

  it('recordings contain NO sub-agent stream_event frames (so sub-agent output stays at its start value)', () => {
    const lines = fs.readFileSync(path.join(REC, 'claude-2.1.259-partial-forwarded-subagent.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.filter((o) => o.type === 'stream_event' && o.parent_tool_use_id)).toHaveLength(0);
    expect(lines.filter((o) => o.type === 'assistant' && o.parent_tool_use_id).length).toBeGreaterThan(0);
  });

  it('includes forwarded sub-agent messages under the same run', () => {
    const msgs = replay('claude-2.1.259-partial-forwarded-subagent.jsonl');
    const sub = msgs.filter((m) => m.sidechain);
    expect(sub).toHaveLength(1);
    expect(sub[0]!.tokens.cacheRead).toBe(13640);
    expect(msgs).toHaveLength(4);
    // Main messages still carry the final output from message_delta.
    expect(msgs.filter((m) => !m.sidechain).map((m) => m.tokens.output)).toEqual([147, 229, 46]);
  });

  it('without --include-partial-messages, the turn result supplies the missing output', () => {
    const msgs = replay('claude-2.1.259-no-partial-messages.jsonl');
    expect(msgs.length).toBeGreaterThan(0);
    const result = fs
      .readFileSync(path.join(REC, 'claude-2.1.259-no-partial-messages.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .find((o) => o.type === 'result');
    const main = msgs.filter((m) => !m.sidechain);
    expect(main.reduce((a, m) => a + m.tokens.output, 0)).toBe(result.usage.output_tokens);
  });
});

describe('Claude collector rules', () => {
  const frame = (usage: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    type: 'assistant',
    request_id: 'req_1',
    timestamp: '2026-10-14T10:00:00.000Z',
    message: { id: 'msg_1', model: 'claude-opus-5-5', usage },
    ...extra,
  });

  it('absent cache_creation means all cache writes are 5-minute writes', () => {
    const out: ClaudeMessageUsage[] = [];
    const c = createClaudeMessageUsageCollector((m) => out.push(m));
    c.observe(frame({ input_tokens: 1, cache_creation_input_tokens: 700, output_tokens: 5 }));
    c.flush();
    expect(out[0]!.tokens.cacheWrite5m).toBe(700);
    expect(out[0]!.tokens.cacheWrite1h).toBe(0);
  });

  it('an explicit zero split is not replaced by the total', () => {
    const out: ClaudeMessageUsage[] = [];
    const c = createClaudeMessageUsageCollector((m) => out.push(m));
    c.observe(
      frame({
        input_tokens: 1,
        cache_creation_input_tokens: 700,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 700 },
        output_tokens: 5,
      }),
    );
    c.flush();
    expect(out[0]!.tokens.cacheWrite1h).toBe(700);
    expect(out[0]!.tokens.cacheWrite5m).toBe(0);
  });

  it('duplicate frames resolve to the max per field', () => {
    const out: ClaudeMessageUsage[] = [];
    const c = createClaudeMessageUsageCollector((m) => out.push(m));
    c.observe(frame({ input_tokens: 10, output_tokens: 4 }));
    c.observe(frame({ input_tokens: 10, output_tokens: 90 }));
    c.observe(frame({ input_tokens: 10, output_tokens: 4 }));
    c.flush();
    expect(out).toHaveLength(1);
    expect(out[0]!.tokens.output).toBe(90);
  });

  it('skips synthetic placeholder messages', () => {
    const out: ClaudeMessageUsage[] = [];
    const c = createClaudeMessageUsageCollector((m) => out.push(m));
    c.observe({ type: 'assistant', message: { id: 'm', model: '<synthetic>', usage: { input_tokens: 1, output_tokens: 1 } } });
    c.flush();
    expect(out).toHaveLength(0);
  });

  it('carries the fast speed', () => {
    const out: ClaudeMessageUsage[] = [];
    const c = createClaudeMessageUsageCollector((m) => out.push(m));
    c.observe(frame({ input_tokens: 10, output_tokens: 4, speed: 'fast' }));
    c.flush();
    expect(out[0]!.speed).toBe('fast');
  });
});
