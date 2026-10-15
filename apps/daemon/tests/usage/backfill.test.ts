import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backfillUsageFromRuns, largestRemainder, refreshProjectNames } from '../../src/usage/backfill.js';
import { insertProject } from '../../src/db.js';
import { queryUsageRows, upsertUsageRecord } from '../../src/usage/store.js';
import { openTempDb, type TempDb } from './helpers.js';

let h: TempDb;
beforeEach(() => { h = openTempDb(); });
afterEach(() => h.cleanup());

function writeRun(id: string, state: Record<string, unknown>, events: Array<Record<string, unknown>>) {
  const dir = path.join(h.dir, 'runs', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ id, agentId: 'claude', projectId: 'p1', createdAt: Date.parse('2026-10-14T10:00:00Z'), resolvedModelId: 'claude-sonnet-5-5', ...state }));
  fs.writeFileSync(
    path.join(dir, 'events.jsonl'),
    events.map((data, i) => JSON.stringify({ id: i + 1, event: 'agent', data, timestamp: Date.parse('2026-10-14T10:00:00Z') + i * 1000 })).join('\n'),
  );
}
const req = (id: string, input: number, cr: number, cc: number, out: number) => ({
  type: 'request_usage', requestId: id,
  usage: { input_tokens: input, cache_read_input_tokens: cr, cache_creation_input_tokens: cc, output_tokens: out },
});
const result = (input: number, cr: number, cc5: number, cc1: number, out: number) => ({
  type: 'usage',
  usage: {
    input_tokens: input, cache_read_input_tokens: cr, cache_creation_input_tokens: cc5 + cc1, output_tokens: out,
    cache_creation: { ephemeral_5m_input_tokens: cc5, ephemeral_1h_input_tokens: cc1 },
  },
});

describe('backfill from events.jsonl', () => {
  const runsDir = () => path.join(h.dir, 'runs');
  const rows = () => queryUsageRows(h.db, { from: '2000-01-01', to: '2999-12-31' });

  it('uses per-message records when they reconcile with result.usage (duplicates collapsed, output fixed)', async () => {
    writeRun('r1', {}, [
      req('m1', 10, 100, 40, 4), req('m1', 10, 100, 40, 4), req('m1', 10, 100, 40, 4),
      req('m2', 5, 200, 60, 2), req('m2', 5, 200, 60, 2),
      result(15, 300, 0, 100, 500),
    ]);
    const res = await backfillUsageFromRuns(h.db, runsDir());
    expect(res).toMatchObject({ runsBackfilled: 1, recordsWritten: 2 });
    const out = rows();
    expect(out).toHaveLength(2);
    expect(out.reduce((a, r) => a + r.tokens.output, 0)).toBe(500);
    expect(out.reduce((a, r) => a + r.tokens.cacheWrite1h, 0)).toBe(100);
    expect(out.reduce((a, r) => a + r.tokens.cacheWrite5m, 0)).toBe(0);
    expect(out.every((r) => r.user === 'automatic' && r.model === 'claude-sonnet-5-5')).toBe(true);
  });

  it('falls back to ONE record from result.usage when per-message data does not reconcile', async () => {
    writeRun('r2', {}, [req('m1', 10, 100, 40, 4), req('sub', 99, 999, 0, 1), result(10, 100, 40, 0, 300)]);
    await backfillUsageFromRuns(h.db, runsDir());
    const out = rows();
    expect(out).toHaveLength(1);
    expect(out[0]!.tokens).toEqual({ input: 10, cacheWrite5m: 40, cacheWrite1h: 0, cacheRead: 100, output: 300 });
  });

  it('is idempotent and skips non-claude runs', async () => {
    writeRun('r3', {}, [result(10, 0, 0, 0, 5)]);
    writeRun('r4', { agentId: 'codex' }, [result(10, 0, 0, 0, 5)]);
    expect(await backfillUsageFromRuns(h.db, runsDir())).toMatchObject({ runsBackfilled: 1, runsSkippedOtherAgent: 1 });
    const second = await backfillUsageFromRuns(h.db, runsDir());
    expect(second).toMatchObject({ runsBackfilled: 0, runsSkippedExisting: 1, recordsWritten: 0 });
    expect(rows()).toHaveLength(1);
  });

  it('a crashed run without result.usage keeps the raw per-message numbers', async () => {
    writeRun('r5', {}, [req('m1', 10, 100, 40, 4)]);
    await backfillUsageFromRuns(h.db, runsDir());
    expect(rows()[0]!.tokens.output).toBe(4);
  });

  it('prices with the concrete model from the initializing event, not the start alias', async () => {
    writeRun('r6', { resolvedModelId: undefined, model: 'opus' }, [
      { type: 'status', label: 'initializing', model: 'claude-opus-5-5', sessionId: 's' },
      result(10, 0, 0, 0, 5),
    ]);
    await backfillUsageFromRuns(h.db, runsDir());
    expect(rows()[0]!.model).toBe('claude-opus-5-5');
    expect(rows()[0]!.costUsd).toBeGreaterThan(0);
  });

  it('maps a bare alias to the current 5.5 id when no concrete model exists', async () => {
    writeRun('r7', { resolvedModelId: undefined, model: 'sonnet' }, [result(10, 0, 0, 0, 5)]);
    await backfillUsageFromRuns(h.db, runsDir());
    expect(rows()[0]!.model).toBe('claude-sonnet-5-5');
  });

  it("state.model 'default' with no concrete model stays unresolved (not priced as 'default')", async () => {
    writeRun('r8', { resolvedModelId: undefined, model: 'default' }, [result(10, 0, 0, 0, 5)]);
    await backfillUsageFromRuns(h.db, runsDir());
    expect(rows()[0]!.model).toBe('unknown');
    expect(rows()[0]!.costUsd).toBe(0);
  });

  it('a concrete initializing model wins over an alias in state.model when resolvedModelId is absent', async () => {
    writeRun('r9', { resolvedModelId: undefined, model: 'opus' }, [
      { type: 'status', label: 'initializing', model: 'claude-haiku-5-5' },
      result(10, 0, 0, 0, 5),
    ]);
    await backfillUsageFromRuns(h.db, runsDir());
    expect(rows()[0]!.model).toBe('claude-haiku-5-5');
  });

  it('cache-write split never goes negative and keeps the turn totals (largest remainder)', async () => {
    // 3 messages with 1 cache-write token each; turn says 1 token was 5m and 2 were 1h.
    writeRun('r10', {}, [
      req('a', 1, 0, 1, 1), req('b', 1, 0, 1, 1), req('c', 1, 0, 1, 1),
      result(3, 0, 1, 2, 3),
    ]);
    await backfillUsageFromRuns(h.db, runsDir());
    const out = rows();
    expect(out).toHaveLength(3);
    for (const r of out) {
      expect(r.tokens.cacheWrite5m).toBeGreaterThanOrEqual(0);
      expect(r.tokens.cacheWrite1h).toBeGreaterThanOrEqual(0);
      expect(r.tokens.cacheWrite5m + r.tokens.cacheWrite1h).toBe(1);
    }
    expect(out.reduce((a, r) => a + r.tokens.cacheWrite5m, 0)).toBe(1);
    expect(out.reduce((a, r) => a + r.tokens.cacheWrite1h, 0)).toBe(2);
  });

  it('largestRemainder allocates exactly', () => {
    expect(largestRemainder([0.5, 0.5, 0.5, 0.5], 2).reduce((a, b) => a + b, 0)).toBe(2);
    expect(largestRemainder([2.4, 3.3, 4.3], 10)).toEqual([3, 3, 4]);
  });

  it('fills project names: live from the projects table, deleted from the latest conversation_title event; idempotent', async () => {
    insertProject(h.db, { id: 'live1', name: 'Live One', createdAt: 1, updatedAt: 1 });
    const tokens = { input: 5, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 5 };
    const rec = (runId: string, projectId: string) =>
      upsertUsageRecord(h.db, { runId, projectId, user: 'automatic', agentId: 'claude', model: 'claude-sonnet-5-5', messageId: 'm', ts: Date.parse('2026-10-14T10:00:00Z'), tokens });
    rec('rl', 'live1'); rec('rd1', 'gone-titled'); rec('rd2', 'gone-untitled');
    h.db.prepare(`UPDATE usage_records SET project_name = NULL`).run(); // as if recorded before names were snapshotted
    writeRun('rd1', { projectId: 'gone-titled' }, [
      { type: 'conversation_title', title: 'Old Title' },
      { type: 'conversation_title', title: 'Tranquil AI 設計系統' },
    ]);
    writeRun('rd2', { projectId: 'gone-untitled' }, [result(1, 0, 0, 0, 1)]);

    const first = await refreshProjectNames(h.db, runsDir());
    expect(first).toEqual({ filled: 2, unrecoverable: 1 });
    const names = Object.fromEntries(rows().map((r) => [r.projectId, r.projectName]));
    expect(names).toEqual({ live1: 'Live One', 'gone-titled': 'Tranquil AI 設計系統', 'gone-untitled': null });
    expect(await refreshProjectNames(h.db, runsDir())).toEqual({ filled: 0, unrecoverable: 1 });
    const bf = await backfillUsageFromRuns(h.db, runsDir());
    expect(bf.deletedProjectsUnnamed).toBe(1);
  });

  it('missing runs directory is fine', async () => {
    expect((await backfillUsageFromRuns(h.db, path.join(h.dir, 'nope'))).runsScanned).toBe(0);
  });
});
