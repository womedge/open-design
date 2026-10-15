import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertProject } from '../../src/db.js';
import { upsertUsageRecord, queryUsageRows, repriceUnpricedRecords } from '../../src/usage/store.js';
import { buildUsageCsv, buildUsageSummary, parseUsageQuery, usageExportFilename } from '../../src/usage/summary.js';
import { USAGE_EXPORT_COLUMNS } from '@open-design/contracts';
import { openTempDb, T, type TempDb } from './helpers.js';

let h: TempDb;
beforeEach(() => {
  h = openTempDb();
  insertProject(h.db, { id: 'p1', name: '專案,一', createdAt: 1, updatedAt: 1 });
});
afterEach(() => h.cleanup());

const tok = (o: Partial<Record<'input' | 'cacheWrite5m' | 'cacheWrite1h' | 'cacheRead' | 'output', number>>) => ({
  input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, ...o,
});
interface AddOpts {
  messageId: string;
  ts: string;
  runId?: string;
  projectId?: string | null;
  user?: string;
  agentId?: string;
  model?: string;
  tokens?: ReturnType<typeof tok>;
}
function add(o: AddOpts) {
  upsertUsageRecord(h.db, {
    runId: o.runId ?? 'run-a',
    projectId: o.projectId === undefined ? 'p1' : o.projectId,
    user: o.user ?? 'a@x.com',
    agentId: o.agentId ?? 'claude',
    model: o.model ?? 'claude-sonnet-5-5',
    tokens: o.tokens ?? tok({ input: 1_000_000 }),
    ts: T(o.ts),
    messageId: o.messageId,
  });
}

describe('storage', () => {
  it('keeps the max when the same message is written twice, and keeps the first cost day', () => {
    add({ messageId: 'm1', ts: '2026-10-14T10:00:00Z', tokens: tok({ output: 10 }) });
    add({ messageId: 'm1', ts: '2026-10-20T10:00:00Z', tokens: tok({ output: 90 }) });
    add({ messageId: 'm1', ts: '2026-10-20T10:00:00Z', tokens: tok({ output: 5 }) });
    const rows = queryUsageRows(h.db, { from: '2026-01-01', to: '2026-12-31' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokens.output).toBe(90);
    expect(rows[0]!.day).toBe('2026-10-14');
  });

  it('buckets by Asia/Taipei day (16:00Z rolls over)', () => {
    add({ messageId: 'a', ts: '2026-10-14T15:59:59Z' });
    add({ messageId: 'b', ts: '2026-10-14T16:00:00Z' });
    const days = queryUsageRows(h.db, { from: '2026-01-01', to: '2026-12-31' }).map((r) => r.day);
    expect(days).toEqual(['2026-10-14', '2026-10-15']);
  });
});

describe('summary', () => {
  beforeEach(() => {
    add({ messageId: 'a1', ts: '2026-10-10T02:00:00Z' }); // $2, run-a, a@x.com
    add({ messageId: 'a2', ts: '2026-10-12T02:00:00Z', tokens: tok({ output: 1_000_000 }) }); // $10
    add({ messageId: 'b1', runId: 'run-b', user: 'automatic', projectId: 'gone', model: 'mystery', ts: '2026-10-12T03:00:00Z' }); // unpriced
    add({ messageId: 'c1', runId: 'run-c', user: 'b@x.com', agentId: 'codex', model: 'gpt-5.5', ts: '2026-10-03T02:00:00Z', tokens: tok({ input: 100_000 }) }); // $0.5 in compare period
  });

  it('totals, zero-filled daily, per-day-per-model split', () => {
    const s = buildUsageSummary(h.db, { from: '2026-10-10', to: '2026-10-13' });
    expect(s.totals).toEqual({ costUsd: 12, tokens: 3_000_000, runs: 2 });
    expect(s.daily.map((d) => d.date)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
    expect(s.daily.map((d) => d.costUsd)).toEqual([2, 0, 10, 0]);
    expect(s.daily[2]!.byModel).toEqual({ 'claude-sonnet-5-5': 10, mystery: 0 });
    expect(s.compareTotals).toBeNull();
    expect(s.compareDaily).toBeNull();
  });

  it('compare period aligned by position', () => {
    const s = buildUsageSummary(h.db, { from: '2026-10-10', to: '2026-10-13', compareFrom: '2026-10-03', compareTo: '2026-10-06' });
    expect(s.compareTotals).toEqual({ costUsd: 0.5, tokens: 100_000, runs: 1 });
    expect(s.compareDaily).toEqual([
      { date: '2026-10-03', costUsd: 0.5 }, { date: '2026-10-04', costUsd: 0 },
      { date: '2026-10-05', costUsd: 0 }, { date: '2026-10-06', costUsd: 0 },
    ]);
    // A compare period without records yields no comparison.
    const none = buildUsageSummary(h.db, { from: '2026-10-10', to: '2026-10-13', compareFrom: '2026-09-01', compareTo: '2026-09-04' });
    expect(none.compareTotals).toBeNull();
  });

  it('projects, people drill-down, models, prices, unpriced, recordedSince', () => {
    const s = buildUsageSummary(h.db, { from: '2026-10-01', to: '2026-10-31' });
    expect(s.projects[0]).toMatchObject({ projectId: 'p1', projectName: '專案,一' });
    expect(s.projects.find((p) => p.projectId === 'gone')!.projectName).toBeNull();
    const a = s.people.find((p) => p.user === 'a@x.com')!;
    expect(a.costUsd).toBe(12);
    expect(a.projects).toEqual([{ key: 'p1', costUsd: 12, tokens: 2_000_000 }]);
    expect(a.models[0]!.key).toBe('claude-sonnet-5-5');
    expect(a.daily).toHaveLength(31);
    expect(s.people.map((p) => p.user)).toContain('automatic');
    expect(s.models.map((m) => m.model)).toEqual(['claude-sonnet-5-5', 'gpt-5.5', 'mystery']);
    expect(s.models.find((m) => m.model === 'gpt-5.5')!.agentIds).toEqual(['codex']);
    expect(s.unpricedModels).toEqual(['mystery']);
    expect(s.prices.map((p) => p.model)).toEqual(['claude-sonnet-5-5', 'gpt-5.5']);
    expect(s.recordedSince).toBe('2026-10-03');
    expect(s.modelTokenTotals.input).toBe(2_100_000);
  });

  it('filters by user / agent / model / project', () => {
    const base = { from: '2026-10-01', to: '2026-10-31' };
    expect(buildUsageSummary(h.db, { ...base, user: 'b@x.com' }).totals.costUsd).toBe(0.5);
    expect(buildUsageSummary(h.db, { ...base, agentId: 'codex' }).totals.runs).toBe(1);
    expect(buildUsageSummary(h.db, { ...base, model: 'mystery' }).totals.costUsd).toBe(0);
    expect(buildUsageSummary(h.db, { ...base, projectId: 'p1' }).totals.runs).toBe(2);
  });

  it('empty range', () => {
    const s = buildUsageSummary(h.db, { from: '2027-01-01', to: '2027-01-02' });
    expect(s.totals).toEqual({ costUsd: 0, tokens: 0, runs: 0 });
    expect(s.daily).toHaveLength(2);
  });
});

describe('reprice + no-project key', () => {
  it('prices records written before the model had a price; idempotent; day-specific; keeps priced rows', async () => {
    add({ messageId: 'u1', runId: 'ru', model: 'future-model', ts: '2026-10-14T02:00:00Z', tokens: tok({ input: 1_000_000 }) });
    add({ messageId: 'p1', runId: 'rp', ts: '2026-10-14T02:00:00Z' }); // already priced
    expect(buildUsageSummary(h.db, { from: '2026-10-14', to: '2026-10-14' }).unpricedModels).toEqual(['future-model']);
    // The price table cannot change at runtime, so rename the row to a model that IS priced.
    h.db.prepare(`UPDATE usage_records SET model = 'claude-sonnet-5-5' WHERE run_id = 'ru'`).run();
    const first = await repriceUnpricedRecords(h.db);
    expect(first).toEqual({ examined: 1, repriced: 1, stillUnpriced: 0 });
    const row = h.db.prepare(`SELECT cost_usd, price_effective_from FROM usage_records WHERE run_id='ru'`).get() as { cost_usd: number; price_effective_from: string };
    expect(row.cost_usd).toBeCloseTo(2);
    expect(row.price_effective_from).toBe('2026-01-01');
    expect(await repriceUnpricedRecords(h.db)).toEqual({ examined: 0, repriced: 0, stillUnpriced: 0 });
  });

  it('still-unpriced models stay as they are', async () => {
    add({ messageId: 'u2', runId: 'ru2', model: 'nope', ts: '2026-10-14T02:00:00Z' });
    expect(await repriceUnpricedRecords(h.db)).toEqual({ examined: 1, repriced: 0, stillUnpriced: 1 });
  });

  it('records without a project group under __none__ and the filter accepts it', () => {
    add({ messageId: 'n1', runId: 'rn', projectId: null, ts: '2026-10-14T02:00:00Z' });
    add({ messageId: 'n2', runId: 'rn2', projectId: 'p1', ts: '2026-10-14T02:00:00Z' });
    const s = buildUsageSummary(h.db, { from: '2026-10-14', to: '2026-10-14' });
    const none = s.projects.find((p) => p.projectId === '__none__')!;
    expect(none).toMatchObject({ projectName: null, runs: 1, costUsd: 2 });
    expect(s.people[0]!.projects.map((p) => p.key).sort()).toEqual(['__none__', 'p1']);
    const only = buildUsageSummary(h.db, { from: '2026-10-14', to: '2026-10-14', projectId: '__none__' });
    expect(only.totals).toMatchObject({ runs: 1, costUsd: 2 });
  });
});

describe('query parsing + CSV export', () => {
  it('validates dates and pairs', () => {
    expect(parseUsageQuery({ from: '2026-10-01' }).ok).toBe(false);
    expect(parseUsageQuery({ from: '2026-10-05', to: '2026-10-01' }).ok).toBe(false);
    expect(parseUsageQuery({ from: '2026-02-30', to: '2026-03-01' }).ok).toBe(false);
    expect(parseUsageQuery({ from: '2026-10-01', to: '2026-10-02', compareFrom: '2026-09-01' }).ok).toBe(false);
    expect(parseUsageQuery({ from: '2026-10-01', to: '2026-10-02', user: 'a@x.com' })).toEqual({
      ok: true,
      query: { from: '2026-10-01', to: '2026-10-02', user: 'a@x.com' },
    });
  });

  it('CSV has the contract columns, a BOM, Taipei date/time and safe cells', () => {
    add({ messageId: 'x', ts: '2026-10-14T16:30:05Z', tokens: tok({ input: 10, cacheWrite1h: 3, output: 7 }) });
    insertProject(h.db, { id: 'p2', name: '=HYPERLINK("x")', createdAt: 1, updatedAt: 1 });
    add({ messageId: 'y', runId: 'run-y', projectId: 'p2', ts: '2026-10-14T16:31:00Z' });
    const csv = buildUsageCsv(queryUsageRows(h.db, { from: '2026-10-01', to: '2026-10-31' }));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe(USAGE_EXPORT_COLUMNS.join(','));
    expect(lines[1]).toBe('2026-10-15,00:30:05,p1,"專案,一",a@x.com,claude,claude-sonnet-5-5,run-a,10,0,3,0,7,' + (((10 * 2 + 3 * 4 + 7 * 10) / 1e6).toString()));
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(usageExportFilename({ from: '2026-10-01', to: '2026-10-31' })).toBe('usage-2026-10-01-2026-10-31.csv');
  });
});
