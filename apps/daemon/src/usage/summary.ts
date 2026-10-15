import type Database from 'better-sqlite3';
import {
  USAGE_EXPORT_COLUMNS,
  type UsageBreakdownRow,
  type UsageDailyRow,
  type UsageModelRow,
  type UsagePersonRow,
  type UsageProjectRow,
  type UsageQuery,
  type UsageSummaryResponse,
  type UsageTokens,
  type UsageTotals,
} from '@open-design/contracts';
import { isPricedModel, pricesUsedInRange, totalTokens } from './pricing.js';
import { NO_PROJECT_KEY, firstRecordedDay, queryUsageRows, type UsageRow } from './store.js';
import { daysBetween, isValidDay, taipeiTime } from './time.js';

type SqliteDb = Database.Database;

const MAX_RANGE_DAYS = 1100;

export type ParsedUsageQuery = { ok: true; query: UsageQuery } | { ok: false; message: string };

function one(v: unknown): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === 'string' && x.trim() ? x.trim() : undefined;
}

/** Validate query-string style input shared by the HTTP routes. */
export function parseUsageQuery(params: Record<string, unknown>): ParsedUsageQuery {
  const from = one(params.from);
  const to = one(params.to);
  if (!isValidDay(from) || !isValidDay(to)) {
    return { ok: false, message: 'from and to are required, as YYYY-MM-DD' };
  }
  if (from > to) return { ok: false, message: 'from must not be after to' };
  if (daysBetween(from, to).length > MAX_RANGE_DAYS) {
    return { ok: false, message: `range must not exceed ${MAX_RANGE_DAYS} days` };
  }
  const compareFrom = one(params.compareFrom);
  const compareTo = one(params.compareTo);
  if ((compareFrom === undefined) !== (compareTo === undefined)) {
    return { ok: false, message: 'compareFrom and compareTo must be given together' };
  }
  if (compareFrom !== undefined && compareTo !== undefined) {
    if (!isValidDay(compareFrom) || !isValidDay(compareTo) || compareFrom > compareTo) {
      return { ok: false, message: 'compareFrom/compareTo must be a valid YYYY-MM-DD range' };
    }
    if (daysBetween(compareFrom, compareTo).length > MAX_RANGE_DAYS) {
      return { ok: false, message: `compare range must not exceed ${MAX_RANGE_DAYS} days` };
    }
  }
  const query: UsageQuery = { from, to };
  if (compareFrom !== undefined && compareTo !== undefined) {
    query.compareFrom = compareFrom;
    query.compareTo = compareTo;
  }
  const projectId = one(params.projectId);
  const user = one(params.user);
  const agentId = one(params.agentId);
  const model = one(params.model);
  if (projectId) query.projectId = projectId;
  if (user) query.user = user;
  if (agentId) query.agentId = agentId;
  if (model) query.model = model;
  return { ok: true, query };
}

const roundCost = (n: number) => Math.round(n * 1e10) / 1e10; // keep sub-cent precision; only strips float noise

function addTokens(into: UsageTokens, t: UsageTokens): void {
  into.input += t.input;
  into.cacheWrite5m += t.cacheWrite5m;
  into.cacheWrite1h += t.cacheWrite1h;
  into.cacheRead += t.cacheRead;
  into.output += t.output;
}

const zeroTokens = (): UsageTokens => ({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 });

function totalsOf(rows: UsageRow[]): UsageTotals {
  let cost = 0;
  let tokens = 0;
  const runs = new Set<string>();
  for (const r of rows) {
    cost += r.costUsd;
    tokens += totalTokens(r.tokens);
    runs.add(r.runId);
  }
  return { costUsd: roundCost(cost), tokens, runs: runs.size };
}

function dailyOf(rows: UsageRow[], days: string[]): Array<UsageDailyRow & { byModel: Record<string, number> }> {
  const byDay = new Map<string, { cost: number; byModel: Record<string, number> }>();
  for (const d of days) byDay.set(d, { cost: 0, byModel: {} });
  for (const r of rows) {
    const slot = byDay.get(r.day);
    if (!slot) continue;
    slot.cost += r.costUsd;
    slot.byModel[r.model] = (slot.byModel[r.model] ?? 0) + r.costUsd;
  }
  return days.map((date) => {
    const slot = byDay.get(date)!;
    const byModel: Record<string, number> = {};
    for (const [k, v] of Object.entries(slot.byModel)) byModel[k] = roundCost(v);
    return { date, costUsd: roundCost(slot.cost), byModel };
  });
}

function breakdown(map: Map<string, { cost: number; tokens: number }>): UsageBreakdownRow[] {
  return [...map.entries()]
    .map(([key, v]) => ({ key, costUsd: roundCost(v.cost), tokens: v.tokens }))
    .sort((a, b) => b.costUsd - a.costUsd || a.key.localeCompare(b.key));
}

/** Sums the stored records on every call; nothing is cached. */
export function buildUsageSummary(db: SqliteDb, q: UsageQuery): UsageSummaryResponse {
  const filter = { projectId: q.projectId, user: q.user, agentId: q.agentId, model: q.model };
  const rows = queryUsageRows(db, { from: q.from, to: q.to, ...filter });
  const days = daysBetween(q.from, q.to);

  let compareTotals: UsageTotals | null = null;
  let compareDaily: UsageDailyRow[] | null = null;
  if (q.compareFrom && q.compareTo) {
    const crows = queryUsageRows(db, { from: q.compareFrom, to: q.compareTo, ...filter });
    if (crows.length > 0) {
      compareTotals = totalsOf(crows);
      compareDaily = dailyOf(crows, daysBetween(q.compareFrom, q.compareTo))
        .slice(0, days.length)
        .map(({ date, costUsd }) => ({ date, costUsd }));
    }
  }

  const projects = new Map<string, { name: string | null; deleted: boolean; cost: number; runs: Set<string> }>();
  const people = new Map<
    string,
    {
      cost: number;
      tokens: number;
      runs: Set<string>;
      projects: Map<string, { cost: number; tokens: number; name: string | null; deleted: boolean }>;
      models: Map<string, { cost: number; tokens: number }>;
      rows: UsageRow[];
    }
  >();
  const models = new Map<
    string,
    { agents: Set<string>; runs: Set<string>; tokens: UsageTokens; cost: number }
  >();
  const modelTokenTotals = zeroTokens();

  for (const r of rows) {
    const total = totalTokens(r.tokens);
    const pk = r.projectId || NO_PROJECT_KEY;
    const p = projects.get(pk) ?? { name: r.projectName, deleted: r.projectDeleted, cost: 0, runs: new Set<string>() };
    if (!p.name && r.projectName) p.name = r.projectName;
    p.cost += r.costUsd;
    p.runs.add(r.runId);
    projects.set(pk, p);

    const person = people.get(r.user) ?? {
      cost: 0,
      tokens: 0,
      runs: new Set<string>(),
      projects: new Map<string, { cost: number; tokens: number; name: string | null; deleted: boolean }>(),
      models: new Map<string, { cost: number; tokens: number }>(),
      rows: [] as UsageRow[],
    };
    person.cost += r.costUsd;
    person.tokens += total;
    person.runs.add(r.runId);
    const pp = person.projects.get(pk) ?? { cost: 0, tokens: 0, name: r.projectName, deleted: r.projectDeleted };
    if (!pp.name && r.projectName) pp.name = r.projectName;
    pp.cost += r.costUsd;
    pp.tokens += total;
    person.projects.set(pk, pp);
    const pm = person.models.get(r.model) ?? { cost: 0, tokens: 0 };
    pm.cost += r.costUsd;
    pm.tokens += total;
    person.models.set(r.model, pm);
    person.rows.push(r);
    people.set(r.user, person);

    const m = models.get(r.model) ?? { agents: new Set<string>(), runs: new Set<string>(), tokens: zeroTokens(), cost: 0 };
    m.agents.add(r.agentId);
    m.runs.add(r.runId);
    addTokens(m.tokens, r.tokens);
    m.cost += r.costUsd;
    models.set(r.model, m);
    addTokens(modelTokenTotals, r.tokens);
  }

  const projectRows: UsageProjectRow[] = [...projects.entries()]
    .map(([projectId, v]) => ({
      projectId,
      projectName: v.name,
      deleted: v.deleted,
      costUsd: roundCost(v.cost),
      runs: v.runs.size,
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.projectId.localeCompare(b.projectId));

  const peopleRows: UsagePersonRow[] = [...people.entries()]
    .map(([user, v]) => ({
      user,
      costUsd: roundCost(v.cost),
      tokens: v.tokens,
      runs: v.runs.size,
      projects: [...v.projects.entries()]
        .map(([key, x]) => ({ key, name: x.name, deleted: x.deleted, costUsd: roundCost(x.cost), tokens: x.tokens }))
        .sort((a, b) => b.costUsd - a.costUsd || a.key.localeCompare(b.key)),
      models: breakdown(v.models),
      daily: dailyOf(v.rows, days).map(({ date, costUsd }) => ({ date, costUsd })),
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.user.localeCompare(b.user));

  const modelRows: UsageModelRow[] = [...models.entries()]
    .map(([model, v]) => ({
      model,
      agentIds: [...v.agents].sort(),
      runs: v.runs.size,
      tokens: v.tokens,
      costUsd: roundCost(v.cost),
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.model.localeCompare(b.model));

  const usedModels = modelRows.map((m) => m.model);
  return {
    query: q,
    totals: totalsOf(rows),
    compareTotals,
    projects: projectRows,
    people: peopleRows,
    daily: dailyOf(rows, days),
    compareDaily,
    models: modelRows,
    modelTokenTotals,
    prices: pricesUsedInRange(usedModels, q.from, q.to),
    unpricedModels: usedModels.filter((m) => !isPricedModel(m)).sort(),
    recordedSince: firstRecordedDay(db),
  };
}

function csvCell(value: string | number): string {
  let text = String(value);
  // Spreadsheet formula injection: project names / emails are user-controlled.
  if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 with BOM so Excel opens the Chinese project names correctly. */
export function buildUsageCsv(rows: UsageRow[]): string {
  const lines: string[] = [USAGE_EXPORT_COLUMNS.join(',')];
  for (const r of rows) {
    const cells: Record<(typeof USAGE_EXPORT_COLUMNS)[number], string | number> = {
      date: r.day,
      time: taipeiTime(r.ts),
      projectId: r.projectId ?? '',
      projectName: r.projectName ?? '',
      user: r.user,
      agentId: r.agentId,
      model: r.model,
      runId: r.runId,
      input: r.tokens.input,
      cacheWrite5m: r.tokens.cacheWrite5m,
      cacheWrite1h: r.tokens.cacheWrite1h,
      cacheRead: r.tokens.cacheRead,
      output: r.tokens.output,
      costUsd: roundCost(r.costUsd),
      projectDeleted: r.projectDeleted ? 'true' : 'false',
    };
    lines.push(USAGE_EXPORT_COLUMNS.map((c) => csvCell(cells[c])).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function usageExportFilename(q: Pick<UsageQuery, 'from' | 'to'>): string {
  return `usage-${q.from}-${q.to}.csv`;
}
