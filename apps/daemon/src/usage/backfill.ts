import type Database from 'better-sqlite3';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import path from 'node:path';
import { USAGE_AUTOMATIC_USER, type UsageTokens } from '@open-design/contracts';
import { upsertUsageRecord } from './store.js';

type SqliteDb = Database.Database;

/**
 * One-time, idempotent rebuild of usage records from past runs'
 * `<runsDir>/<runId>/events.jsonl` (Claude only: it is the only agent whose
 * events carry usage in a usable shape). Past runs have no recorded starter, so
 * they count as `automatic`.
 *
 * Which data to trust (what the old event log can and cannot say):
 *   - `request_usage` events are per assistant message but (a) are repeated 2-3
 *     times per message, (b) carry the output count at message START (a large
 *     under-count), (c) have no 5m/1h cache split, and (d) can include
 *     forwarded sub-agent messages that the run's `result.usage` excludes.
 *   - `usage` events are the raw `result.usage` of one user turn: exact totals
 *     and the cache split, but only per turn, so a long-context tier cannot be
 *     judged per message from them.
 * Per user turn we therefore use the per-message `request_usage` records (deduped
 * to the max per message) ONLY when their input/cache-read/cache-write sums
 * reconcile exactly with that turn's `result.usage`; then the output shortfall
 * is added to the last message and cache writes are split by the turn's 5m/1h
 * ratio. When they do not reconcile (sub-agents, missing frames) or no
 * request_usage exists, the turn is stored as ONE record from `result.usage`.
 * A turn with request_usage but no `usage` event (crashed run) keeps the raw
 * per-message numbers (output under-counted; nothing better exists).
 */

export interface BackfillResult {
  runsScanned: number;
  runsBackfilled: number;
  /** Already had records (live or from an earlier backfill). */
  runsSkippedExisting: number;
  runsSkippedOtherAgent: number;
  runsWithoutUsage: number;
  recordsWritten: number;
  /** Records that got a project name snapshot (live name, or recovered for a deleted project). */
  projectNamesFilled: number;
  /** Deleted projects whose name could not be recovered (left null). */
  deletedProjectsUnnamed: number;
}

/**
 * Aliases the CLI accepts, mapped to the current Claude 5.5 ids. Used ONLY when
 * a run's events carry no concrete model id (so cost is not left at 0); a run
 * that really used an older model is therefore priced as the 5.5 one.
 */
const CLAUDE_ALIAS_TO_MODEL: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

const isConcreteModel = (m: unknown): m is string => typeof m === 'string' && /^claude-/i.test(m);

/** Concrete model from the 'initializing' status event or any assistant frame in the log. */
function concreteModelFromEvents(raw: string): string | null {
  for (const line of raw.split('\n')) {
    if (!line.includes('claude-')) continue;
    try {
      const data = (JSON.parse(line) as Record<string, any>).data as Record<string, any> | undefined;
      if (data?.type === 'status' && data.label === 'initializing' && isConcreteModel(data.model)) return data.model;
      if (isConcreteModel(data?.message?.model)) return data.message.model;
    } catch { /* skip malformed line */ }
  }
  return null;
}

/** Integer allocation of `target` over fractional `shares` (which sum to ~target). */
export function largestRemainder(shares: number[], target: number): number[] {
  const floors = shares.map((x) => Math.max(0, Math.floor(x + 1e-9)));
  let left = target - floors.reduce((a, b) => a + b, 0);
  const order = shares
    .map((x, i) => ({ i, frac: x - Math.floor(x + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left -= 1) floors[order[k]!.i]! += 1;
  return floors;
}

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
function rec(v: unknown): Record<string, any> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null;
}

interface ReqUsage { input: number; cacheRead: number; cacheCreation: number; output: number; ts: number }

function tokensFromTurn(u: Record<string, any>): { tokens: UsageTokens; speed: string | null } {
  const total = n(u.cache_creation_input_tokens);
  const cc = rec(u.cache_creation);
  let w5 = total;
  let w1 = 0;
  if (cc) {
    w5 = n(cc.ephemeral_5m_input_tokens);
    w1 = n(cc.ephemeral_1h_input_tokens);
    if (w5 + w1 < total) w5 += total - (w5 + w1);
  }
  return {
    tokens: { input: n(u.input_tokens), cacheWrite5m: w5, cacheWrite1h: w1, cacheRead: n(u.cache_read_input_tokens), output: n(u.output_tokens) },
    speed: typeof u.speed === 'string' ? u.speed : null,
  };
}

export async function backfillUsageFromRuns(db: SqliteDb, runsDir: string): Promise<BackfillResult> {
  const result: BackfillResult = {
    runsScanned: 0,
    runsBackfilled: 0,
    runsSkippedExisting: 0,
    runsSkippedOtherAgent: 0,
    runsWithoutUsage: 0,
    recordsWritten: 0,
    projectNamesFilled: 0,
    deletedProjectsUnnamed: 0,
  };
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(runsDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const hasRecords = db.prepare(`SELECT 1 FROM usage_records WHERE run_id = ? LIMIT 1`);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Past runs can be many and large: read asynchronously and let other
    // requests through between runs.
    await yieldToEventLoop();
    const runId = entry.name;
    const dir = path.join(runsDir, runId);
    let state: Record<string, any> | null = null;
    try {
      state = rec(JSON.parse(await fsp.readFile(path.join(dir, 'state.json'), 'utf8')));
    } catch {
      continue;
    }
    if (!state) continue;
    result.runsScanned += 1;
    if (state.agentId !== 'claude') {
      result.runsSkippedOtherAgent += 1;
      continue;
    }
    if (hasRecords.get(runId)) {
      result.runsSkippedExisting += 1;
      continue;
    }
    let raw = '';
    try {
      raw = await fsp.readFile(path.join(dir, 'events.jsonl'), 'utf8');
    } catch {
      result.runsWithoutUsage += 1;
      continue;
    }

    const startModel =
      (typeof state.resolvedModelId === 'string' && state.resolvedModelId) ||
      (typeof state.model === 'string' && state.model) ||
      null;
    // Concrete id from the log beats the start event's alias ('opus'); an
    // alias is mapped only when nothing concrete exists.
    const model: string | null =
      concreteModelFromEvents(raw) ??
      (isConcreteModel(startModel) ? startModel : null) ??
      (startModel && startModel.trim().toLowerCase() !== 'default'
        ? CLAUDE_ALIAS_TO_MODEL[startModel.trim().toLowerCase()] ?? startModel
        : null);
    let turnReqs = new Map<string, ReqUsage>();
    const written: Array<Parameters<typeof upsertUsageRecord>[1]> = [];
    let turnIndex = 0;
    const base = {
      runId,
      projectId: typeof state.projectId === 'string' ? state.projectId : null,
      user: typeof state.usageUser === 'string' && state.usageUser ? state.usageUser : USAGE_AUTOMATIC_USER,
      agentId: 'claude',
      source: 'backfill' as const,
    };
    const fallbackTs = n(state.createdAt) || Date.now();

    const flushTurn = (turnUsage: Record<string, any> | null, ts: number) => {
      turnIndex += 1;
      const reqs = [...turnReqs.entries()];
      turnReqs = new Map();
      const modelId = model ?? 'unknown';
      if (!turnUsage) {
        for (const [id, r] of reqs) {
          written.push({ ...base, model: modelId, messageId: `bf:${id}`, ts: r.ts || ts,
            tokens: { input: r.input, cacheWrite5m: r.cacheCreation, cacheWrite1h: 0, cacheRead: r.cacheRead, output: r.output } });
        }
        return;
      }
      const turn = tokensFromTurn(turnUsage);
      const sum = reqs.reduce((a, [, r]) => ({ input: a.input + r.input, cr: a.cr + r.cacheRead, cc: a.cc + r.cacheCreation, out: a.out + r.output }), { input: 0, cr: 0, cc: 0, out: 0 });
      const cacheWritesTotal = turn.tokens.cacheWrite5m + turn.tokens.cacheWrite1h;
      const reconciles =
        reqs.length > 0 &&
        sum.input === turn.tokens.input &&
        sum.cr === turn.tokens.cacheRead &&
        sum.cc === cacheWritesTotal &&
        sum.out <= turn.tokens.output;
      if (!reconciles) {
        written.push({ ...base, model: modelId, messageId: `bf:turn:${turnIndex}`, ts, tokens: turn.tokens, speed: turn.speed });
        return;
      }
      // Split each message's cache writes by the turn's 5m/1h ratio with the
      // largest-remainder method: integer, never negative, and the per-message
      // shares add up exactly to the turn's 5m total (so 1h = writes - 5m >= 0).
      const w5 = largestRemainder(
        reqs.map(([, r]) => (cacheWritesTotal === 0 ? 0 : (r.cacheCreation * turn.tokens.cacheWrite5m) / cacheWritesTotal)),
        turn.tokens.cacheWrite5m,
      );
      reqs.forEach(([id, r], i) => {
        const last = i === reqs.length - 1;
        written.push({
          ...base, model: modelId, messageId: `bf:${id}`, ts: r.ts || ts, speed: turn.speed,
          tokens: {
            input: r.input, cacheWrite5m: w5[i]!, cacheWrite1h: r.cacheCreation - w5[i]!, cacheRead: r.cacheRead,
            output: r.output + (last ? turn.tokens.output - sum.out : 0),
          },
        });
      });
    };

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let ev: Record<string, any> | null = null;
      try { ev = rec(JSON.parse(line)); } catch { continue; }
      if (!ev || ev.event !== 'agent') continue;
      const data = rec(ev.data);
      if (!data) continue;
      const ts = n(ev.timestamp) || fallbackTs;
      if (data.type === 'request_usage' && typeof data.requestId === 'string') {
        const u = rec(data.usage);
        if (!u) continue;
        const prev = turnReqs.get(data.requestId);
        const next: ReqUsage = {
          input: Math.max(prev?.input ?? 0, n(u.input_tokens)),
          cacheRead: Math.max(prev?.cacheRead ?? 0, n(u.cache_read_input_tokens)),
          cacheCreation: Math.max(prev?.cacheCreation ?? 0, n(u.cache_creation_input_tokens)),
          output: Math.max(prev?.output ?? 0, n(u.output_tokens)),
          ts: prev?.ts || ts,
        };
        turnReqs.set(data.requestId, next);
      } else if (data.type === 'usage' && rec(data.usage)) {
        flushTurn(rec(data.usage), ts);
      }
    }
    if (turnReqs.size > 0) flushTurn(null, fallbackTs);

    let wrote = 0;
    const tx = db.transaction(() => {
      for (const r of written) if (upsertUsageRecord(db, r)) wrote += 1;
    });
    tx();
    if (wrote > 0) {
      result.runsBackfilled += 1;
      result.recordsWritten += wrote;
    } else {
      result.runsWithoutUsage += 1;
    }
  }
  const names = await refreshProjectNames(db, runsDir);
  result.projectNamesFilled = names.filled;
  result.deletedProjectsUnnamed = names.unrecoverable;
  return result;
}

/**
 * Fill `usage_records.project_name` where it is still empty (idempotent).
 *
 *  1. Live projects: copy the current name from the projects table.
 *  2. Deleted projects: deleting a project cascades away its conversations,
 *     messages, comments and files, so the name survives in only one place —
 *     the `conversation_title` event the agent emitted into a run's
 *     `runs/<runId>/events.jsonl` (verified on production data: run
 *     state.json files and every table hold no project name after deletion).
 *     The latest such title across the project's runs is used. That is the
 *     conversation title, which equals the project name for design-system
 *     projects and the usual auto-named ones, but a project whose runs never
 *     emitted a title stays unnamed (null) rather than guessing from a prompt.
 */
export async function refreshProjectNames(
  db: SqliteDb,
  runsDir: string,
): Promise<{ filled: number; unrecoverable: number }> {
  let filled = db
    .prepare(
      `UPDATE usage_records
          SET project_name = (SELECT name FROM projects WHERE projects.id = usage_records.project_id)
        WHERE project_name IS NULL AND project_id IN (SELECT id FROM projects)`,
    )
    .run().changes;
  const missing = db
    .prepare(
      `SELECT DISTINCT project_id AS id FROM usage_records
        WHERE project_name IS NULL AND project_id IS NOT NULL AND project_id != ''
          AND project_id NOT IN (SELECT id FROM projects)`,
    )
    .all() as Array<{ id: string }>;
  const runsOf = db.prepare(`SELECT run_id FROM usage_records WHERE project_id = ? GROUP BY run_id ORDER BY MAX(ts) DESC`);
  const setName = db.prepare(`UPDATE usage_records SET project_name = ? WHERE project_id = ? AND project_name IS NULL`);
  let unrecoverable = 0;
  for (const { id } of missing) {
    await yieldToEventLoop();
    let title: string | null = null;
    for (const { run_id } of runsOf.all(id) as Array<{ run_id: string }>) {
      title = await lastConversationTitle(path.join(runsDir, run_id, 'events.jsonl'));
      if (title) break;
    }
    if (title) filled += setName.run(title, id).changes;
    else unrecoverable += 1;
  }
  return { filled, unrecoverable };
}

async function lastConversationTitle(file: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
  if (!raw.includes('conversation_title')) return null;
  let title: string | null = null;
  for (const line of raw.split('\n')) {
    if (!line.includes('conversation_title')) continue;
    try {
      const data = rec(JSON.parse(line))?.data;
      if (data?.type === 'conversation_title' && typeof data.title === 'string' && data.title.trim()) title = data.title.trim();
    } catch { /* skip */ }
  }
  return title;
}

