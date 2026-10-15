import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { USAGE_AUTOMATIC_USER } from '@open-design/contracts';
import { createRunUsageRecorder, resolveUsageUser } from '../../src/usage/recorder.js';
import { queryUsageRows } from '../../src/usage/store.js';
import { openTempDb, T, type TempDb } from './helpers.js';

let h: TempDb;
beforeEach(() => { h = openTempDb(); });
afterEach(() => h.cleanup());

const rows = () => queryUsageRows(h.db, { from: '2000-01-01', to: '2999-12-31' });

describe('Codex cumulative usage -> per-call deltas', () => {
  const make = (extra: Partial<Parameters<typeof createRunUsageRecorder>[0]> = {}) =>
    createRunUsageRecorder({
      db: h.db,
      run: { id: 'run-1', projectId: 'p1', usageUser: 'a@x.com' },
      agentId: 'codex',
      getModel: () => 'gpt-5.5',
      getThreadId: () => 'thread-1',
      now: () => T('2026-10-15T02:00:00Z'),
      ...extra,
    });
  const u = (input: number, cached: number, output: number, thought = 0) => ({
    usage: { input_tokens: input, cached_read_tokens: cached, output_tokens: output, thought_tokens: thought },
  });

  it('subtracts the previous value; cached is inside input, reasoning inside output', () => {
    const r = make();
    r.observeAgentUsage(u(1000, 400, 100, 60));
    r.observeAgentUsage(u(2500, 1400, 250, 150));
    const out = rows();
    expect(out).toHaveLength(2);
    expect(out[0]!.tokens).toEqual({ input: 600, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 400, output: 100 });
    expect(out[1]!.tokens).toEqual({ input: 500, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 1000, output: 150 });
    expect(out[0]!.user).toBe('a@x.com');
    expect(out[0]!.model).toBe('gpt-5.5');
  });

  it('a counter reset (smaller value) is taken whole', () => {
    const r = make();
    r.observeAgentUsage(u(5000, 0, 500));
    r.observeAgentUsage(u(300, 0, 40));
    expect(rows().map((x) => x.tokens.input)).toEqual([5000, 300]);
  });

  it('a later run on the same thread subtracts the earlier run via the stored cursor', () => {
    make().observeAgentUsage(u(1000, 0, 100));
    const second = make({ run: { id: 'run-2', projectId: 'p1' }, isResuming: () => true });
    second.observeAgentUsage(u(1800, 0, 160));
    const run2 = rows().filter((x) => x.runId === 'run-2');
    expect(run2).toHaveLength(1);
    expect(run2[0]!.tokens.input).toBe(800);
    expect(run2[0]!.tokens.output).toBe(60);
    expect(run2[0]!.user).toBe(USAGE_AUTOMATIC_USER);
  });

  it('a resumed thread with no known baseline is not billed for its history', () => {
    const r = make({ getThreadId: () => 'old-thread', isResuming: () => true });
    r.observeAgentUsage(u(900_000, 0, 9_000));
    expect(rows()).toHaveLength(0);
    r.observeAgentUsage(u(901_000, 0, 9_100));
    expect(rows()[0]!.tokens.input).toBe(1000);
  });

  it('fast tier is priced with the multiplier', () => {
    const slow = make();
    slow.observeAgentUsage(u(1_000_000, 0, 0));
    const fast = make({ run: { id: 'run-f', projectId: 'p1' }, getThreadId: () => 'tf', getSpeed: () => 'fast' });
    fast.observeAgentUsage(u(1_000_000, 0, 0));
    const [a, b] = [rows().find((x) => x.runId === 'run-1')!, rows().find((x) => x.runId === 'run-f')!];
    expect(b.costUsd).toBeCloseTo(a.costUsd * 2.5);
  });
});

describe('OpenCode steps', () => {
  it('stores one record per step; reasoning billed as output', () => {
    const r = createRunUsageRecorder({
      db: h.db,
      run: { id: 'run-oc', projectId: 'p2' },
      agentId: 'opencode',
      getModel: () => 'anthropic/claude-sonnet-5-5',
      now: () => T('2026-10-15T02:00:00Z'),
    });
    r.observeAgentUsage({ usage: { input_tokens: 100, output_tokens: 50, thought_tokens: 30, cached_read_tokens: 1000, cached_write_tokens: 200 } });
    r.observeAgentUsage({ usage: { input_tokens: 10, output_tokens: 5 } });
    const out = rows();
    expect(out).toHaveLength(2);
    expect(out[0]!.tokens).toEqual({ input: 100, cacheWrite5m: 200, cacheWrite1h: 0, cacheRead: 1000, output: 80 });
    expect(out[0]!.model).toBe('claude-sonnet-5-5');
    expect(out.reduce((a, x) => a + x.tokens.output, 0)).toBe(85);
  });

  it('other agents are not metered here', () => {
    const r = createRunUsageRecorder({ db: h.db, run: { id: 'r' }, agentId: 'gemini', getModel: () => 'x' });
    r.observeAgentUsage({ usage: { input_tokens: 1, output_tokens: 1 } });
    expect(rows()).toHaveLength(0);
  });
});

describe('model discovery and agent-reported cost', () => {
  it('Codex: the model reported by thread/start replaces an unknown requested model', () => {
    const r = createRunUsageRecorder({
      db: h.db, run: { id: 'run-cm', projectId: 'p1' }, agentId: 'codex',
      getModel: () => 'default', getThreadId: () => 't-cm', now: () => T('2026-10-15T02:00:00Z'),
    });
    r.setObservedModel('gpt-5.5');
    r.observeAgentUsage({ usage: { input_tokens: 1_000_000, output_tokens: 0 } });
    const row = rows()[0]!;
    expect(row.model).toBe('gpt-5.5');
    expect(row.costUsd).toBeCloseTo(10); // 1M > 272K => long-context rate
  });

  it('OpenCode: unpriced model uses the cost the step reported; priced model ignores it', () => {
    const mk = (id: string, model: string) => createRunUsageRecorder({
      db: h.db, run: { id }, agentId: 'opencode', getModel: () => model, now: () => T('2026-10-15T02:00:00Z'),
    });
    mk('oc1', 'someprovider/weird-model').observeAgentUsage({ usage: { input_tokens: 10, output_tokens: 5 }, costUsd: 0.42 });
    mk('oc2', 'anthropic/claude-sonnet-5-5').observeAgentUsage({ usage: { input_tokens: 1_000_000 }, costUsd: 99 });
    const byRun = Object.fromEntries(rows().map((x) => [x.runId, x]));
    expect(byRun.oc1!.costUsd).toBe(0.42);
    expect(byRun.oc1!.model).toBe('weird-model');
    expect(byRun.oc2!.costUsd).toBeCloseTo(2);
  });

  it('byok-opencode is metered like opencode', () => {
    createRunUsageRecorder({
      db: h.db, run: { id: 'bo' }, agentId: 'byok-opencode', getModel: () => 'byok/claude-opus-5-5', now: () => T('2026-10-15T02:00:00Z'),
    }).observeAgentUsage({ usage: { input_tokens: 1_000_000 } });
    expect(rows()[0]).toMatchObject({ agentId: 'byok-opencode', model: 'claude-opus-5-5' });
    expect(rows()[0]!.costUsd).toBeCloseTo(4);
  });
});

describe('resolveUsageUser', () => {
  const req = (peer: string | undefined, email?: string) => ({
    get: (n: string) => (n.toLowerCase() === 'x-forwarded-email' ? email : undefined),
    socket: { remoteAddress: peer },
  });
  it('trusts the proxy header from a non-loopback peer', () => {
    expect(resolveUsageUser(req('10.0.0.5', 'Sam@Example.com'))).toBe('sam@example.com');
  });
  it('ignores the header from loopback peers (v4, v6, mapped)', () => {
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(resolveUsageUser(req(peer, 'sam@example.com'))).toBe(USAGE_AUTOMATIC_USER);
    }
  });
  it('falls back to automatic when the header is missing, malformed or the peer unknown', () => {
    expect(resolveUsageUser(req('10.0.0.5'))).toBe(USAGE_AUTOMATIC_USER);
    expect(resolveUsageUser(req('10.0.0.5', 'not-an-email'))).toBe(USAGE_AUTOMATIC_USER);
    expect(resolveUsageUser(req(undefined, 'sam@example.com'))).toBe(USAGE_AUTOMATIC_USER);
  });
});
