import type Database from 'better-sqlite3';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import type { UsageTokens } from '@open-design/contracts';
import { computeCost, normalizeModelId, totalTokens } from './pricing.js';
import { taipeiDay } from './time.js';

type SqliteDb = Database.Database;

/**
 * One row per (run, assistant message). Created by `migrate()` in db.ts.
 * `cost_usd` is written once, at the price effective on `day`, and is never
 * recomputed afterwards.
 */
export function migrateUsageTables(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      project_id TEXT,
      user TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      model TEXT NOT NULL,
      message_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      day TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_5m INTEGER NOT NULL DEFAULT 0,
      cache_write_1h INTEGER NOT NULL DEFAULT 0,
      cache_read INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      price_effective_from TEXT,
      speed TEXT,
      source TEXT NOT NULL DEFAULT 'live',
      UNIQUE(run_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_usage_records_day ON usage_records(day);
    CREATE INDEX IF NOT EXISTS idx_usage_records_project_day ON usage_records(project_id, day);
    CREATE INDEX IF NOT EXISTS idx_usage_records_user_day ON usage_records(user, day);
    CREATE INDEX IF NOT EXISTS idx_usage_records_run ON usage_records(run_id);

    -- Last cumulative counters seen per Codex thread, so the next run on the
    -- same thread can subtract them (Codex reports thread-cumulative usage).
    CREATE TABLE IF NOT EXISTS usage_cursors (
      thread_id TEXT PRIMARY KEY,
      input_tokens INTEGER NOT NULL,
      cached_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  // Project name at write time, so the original name survives project deletion.
  // Idempotent column add (SQLite has no ADD COLUMN IF NOT EXISTS).
  const cols = db.prepare(`PRAGMA table_info(usage_records)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'project_name')) {
    db.exec(`ALTER TABLE usage_records ADD COLUMN project_name TEXT`);
  }
}

export interface UsageRecordInput {
  runId: string;
  projectId: string | null;
  user: string;
  agentId: string;
  /** Raw vendor model id; stored normalized. */
  model: string;
  messageId: string;
  ts: number;
  tokens: UsageTokens;
  speed?: string | null;
  source?: 'live' | 'backfill';
  /** Cost the agent itself reported (OpenCode); used only when our table has no price for the model. */
  reportedCostUsd?: number | null;
  /** Defaults to the project's current name from the projects table. */
  projectName?: string | null;
}

function costOf(model: string, day: string, input: UsageRecordInput) {
  const c = computeCost(model, day, input.tokens, input.speed);
  if (!c.priced && typeof input.reportedCostUsd === 'number' && input.reportedCostUsd > 0) {
    return { costUsd: input.reportedCostUsd, priceEffectiveFrom: null as string | null };
  }
  return { costUsd: c.costUsd, priceEffectiveFrom: c.priceEffectiveFrom };
}

/**
 * Reserved project key for records whose run had no project (deleted or never
 * assigned). Summaries group them under this key with `projectName: null`, and
 * the `projectId` filter accepts it. Daemon-local: the contract is unchanged.
 */
export const NO_PROJECT_KEY = '__none__';

export const EMPTY_TOKENS: UsageTokens = {
  input: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  output: 0,
};

/**
 * Insert a record, or — when the same (run, message) is seen again — keep the
 * larger one (ccusage's rule: duplicated frames of one message resolve to the
 * max token total). Returns whether a row was written.
 */
function snapshotProjectName(db: SqliteDb, input: UsageRecordInput): string | null {
  if (typeof input.projectName === 'string' && input.projectName) return input.projectName;
  if (!input.projectId) return null;
  try {
    const r = db.prepare(`SELECT name FROM projects WHERE id = ?`).get(input.projectId) as { name?: string } | undefined;
    return r?.name || null;
  } catch {
    return null;
  }
}

export function upsertUsageRecord(db: SqliteDb, input: UsageRecordInput): boolean {
  const total = totalTokens(input.tokens);
  if (total <= 0) return false;
  const model = normalizeModelId(input.model);
  const existing = db
    .prepare(`SELECT id, total_tokens, day FROM usage_records WHERE run_id = ? AND message_id = ?`)
    .get(input.runId, input.messageId) as { id: number; total_tokens: number; day: string } | undefined;
  const projectName = snapshotProjectName(db, input);
  if (existing) {
    if (projectName) {
      db.prepare(`UPDATE usage_records SET project_name = ? WHERE id = ? AND project_name IS NULL`).run(projectName, existing.id);
    }
    if (total <= existing.total_tokens) return false;
    const cost = costOf(model, existing.day, input);
    db.prepare(
      `UPDATE usage_records SET model = ?, input_tokens = ?, cache_write_5m = ?, cache_write_1h = ?,
         cache_read = ?, output_tokens = ?, total_tokens = ?, cost_usd = ?, price_effective_from = ?, speed = ?
       WHERE id = ?`,
    ).run(
      model,
      input.tokens.input,
      input.tokens.cacheWrite5m,
      input.tokens.cacheWrite1h,
      input.tokens.cacheRead,
      input.tokens.output,
      total,
      cost.costUsd,
      cost.priceEffectiveFrom,
      input.speed ?? null,
      existing.id,
    );
    return true;
  }
  const day = taipeiDay(input.ts);
  const cost = costOf(model, day, input);
  db.prepare(
    `INSERT INTO usage_records (run_id, project_id, user, agent_id, model, message_id, ts, day,
       input_tokens, cache_write_5m, cache_write_1h, cache_read, output_tokens, total_tokens,
       cost_usd, price_effective_from, speed, source, project_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.runId,
    input.projectId,
    input.user,
    input.agentId,
    model,
    input.messageId,
    input.ts,
    day,
    input.tokens.input,
    input.tokens.cacheWrite5m,
    input.tokens.cacheWrite1h,
    input.tokens.cacheRead,
    input.tokens.output,
    total,
    cost.costUsd,
    cost.priceEffectiveFrom,
    input.speed ?? null,
    input.source ?? 'live',
    projectName,
  );
  return true;
}

export interface UsageRow {
  runId: string;
  projectId: string | null;
  /** Live name, else the name snapshotted on the record. */
  projectName: string | null;
  /** The project id no longer exists in the projects table. */
  projectDeleted: boolean;
  user: string;
  agentId: string;
  model: string;
  ts: number;
  day: string;
  tokens: UsageTokens;
  costUsd: number;
}

export interface UsageRowFilter {
  from: string;
  to: string;
  projectId?: string | undefined;
  user?: string | undefined;
  agentId?: string | undefined;
  model?: string | undefined;
}

export function queryUsageRows(db: SqliteDb, f: UsageRowFilter): UsageRow[] {
  const where = ['r.day >= ?', 'r.day <= ?'];
  const args: unknown[] = [f.from, f.to];
  if (f.projectId === NO_PROJECT_KEY) where.push(`(r.project_id IS NULL OR r.project_id = '')`);
  else if (f.projectId) { where.push('r.project_id = ?'); args.push(f.projectId); }
  if (f.user) { where.push('r.user = ?'); args.push(f.user); }
  if (f.agentId) { where.push('r.agent_id = ?'); args.push(f.agentId); }
  if (f.model) { where.push('r.model = ?'); args.push(normalizeModelId(f.model)); }
  const rows = db
    .prepare(
      `SELECT r.run_id, r.project_id, p.name AS live_name, p.id AS live_id, r.project_name AS snap_name, r.user, r.agent_id, r.model, r.ts, r.day,
              r.input_tokens, r.cache_write_5m, r.cache_write_1h, r.cache_read, r.output_tokens, r.cost_usd
         FROM usage_records r LEFT JOIN projects p ON p.id = r.project_id
        WHERE ${where.join(' AND ')}
        ORDER BY r.ts, r.id`,
    )
    .all(...args) as Array<Record<string, any>>;
  return rows.map((r) => ({
    runId: r.run_id,
    projectId: r.project_id ?? null,
    projectName: r.live_name ?? r.snap_name ?? null,
    projectDeleted: !!r.project_id && r.live_id == null,
    user: r.user,
    agentId: r.agent_id,
    model: r.model,
    ts: r.ts,
    day: r.day,
    tokens: {
      input: r.input_tokens,
      cacheWrite5m: r.cache_write_5m,
      cacheWrite1h: r.cache_write_1h,
      cacheRead: r.cache_read,
      output: r.output_tokens,
    },
    costUsd: r.cost_usd,
  }));
}

export function firstRecordedDay(db: SqliteDb): string | null {
  const row = db.prepare(`SELECT MIN(day) AS d FROM usage_records`).get() as { d: string | null } | undefined;
  return row?.d ?? null;
}

export interface CodexCursor {
  input: number;
  cached: number;
  output: number;
}

export function getCodexCursor(db: SqliteDb, threadId: string): CodexCursor | null {
  const r = db
    .prepare(`SELECT input_tokens, cached_tokens, output_tokens FROM usage_cursors WHERE thread_id = ?`)
    .get(threadId) as { input_tokens: number; cached_tokens: number; output_tokens: number } | undefined;
  return r ? { input: r.input_tokens, cached: r.cached_tokens, output: r.output_tokens } : null;
}

export function setCodexCursor(db: SqliteDb, threadId: string, c: CodexCursor, now: number): void {
  db.prepare(
    `INSERT INTO usage_cursors (thread_id, input_tokens, cached_tokens, output_tokens, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(thread_id) DO UPDATE SET input_tokens = excluded.input_tokens,
       cached_tokens = excluded.cached_tokens, output_tokens = excluded.output_tokens, updated_at = excluded.updated_at`,
  ).run(threadId, c.input, c.cached, c.output, now);
}

/**
 * Re-price records that had no price when written (`price_effective_from IS
 * NULL`), using the price in effect on each record's own day. Records that
 * already carry a price are never touched, so running it twice changes nothing.
 * A record whose model is still unpriced (cost 0, or the agent-reported cost)
 * stays as it is.
 */
export async function repriceUnpricedRecords(db: SqliteDb): Promise<{ examined: number; repriced: number; stillUnpriced: number }> {
  const rows = db
    .prepare(
      `SELECT id, model, day, input_tokens, cache_write_5m, cache_write_1h, cache_read, output_tokens, speed
         FROM usage_records WHERE price_effective_from IS NULL`,
    )
    .all() as Array<Record<string, any>>;
  const update = db.prepare(`UPDATE usage_records SET cost_usd = ?, price_effective_from = ? WHERE id = ?`);
  let repriced = 0;
  const BATCH = 500;
  for (let from = 0; from < rows.length; from += BATCH) {
    // Yield between batches so a large table never blocks the event loop.
    if (from > 0) await yieldToEventLoop();
    const batch = rows.slice(from, from + BATCH);
    db.transaction(() => {
    for (const r of batch) {
      const c = computeCost(
        r.model,
        r.day,
        { input: r.input_tokens, cacheWrite5m: r.cache_write_5m, cacheWrite1h: r.cache_write_1h, cacheRead: r.cache_read, output: r.output_tokens },
        r.speed,
      );
      if (!c.priced) continue;
      update.run(c.costUsd, c.priceEffectiveFrom, r.id);
      repriced += 1;
    }
    })();
  }
  return { examined: rows.length, repriced, stillUnpriced: rows.length - repriced };
}
