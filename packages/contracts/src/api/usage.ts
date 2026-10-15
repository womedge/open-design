/**
 * Token usage statistics (AWP+). The daemon prices every assistant message
 * once, at the price in effect on the day it was used, and stores one usage
 * record per message. `GET /api/usage/summary` sums those records for the
 * requested filters on every call (no cache); `GET /api/usage/export` returns
 * the same filtered records as CSV. `od usage summary|export` call the same
 * endpoints.
 *
 * Dates are calendar days in Asia/Taipei, formatted `YYYY-MM-DD`, inclusive.
 */

export type UsageAgentId = 'claude' | 'codex' | 'opencode' | (string & {});

/** Token counts. Cache writes are split by TTL; reads are separate. */
export interface UsageTokens {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface UsageQuery {
  /** Inclusive start day, `YYYY-MM-DD` (Asia/Taipei). */
  from: string;
  /** Inclusive end day, `YYYY-MM-DD` (Asia/Taipei). */
  to: string;
  /** Optional comparison period; omitted means no comparison. */
  compareFrom?: string;
  compareTo?: string;
  projectId?: string;
  /** Google account email, or `USAGE_AUTOMATIC_USER` for runs nobody started. */
  user?: string;
  agentId?: UsageAgentId;
  /** Concrete model id, e.g. `claude-opus-5-5`. */
  model?: string;
}

/** Runs with no signed-in user (routines, background refresh, local calls). */
export const USAGE_AUTOMATIC_USER = 'automatic';

export interface UsageTotals {
  costUsd: number;
  /** Sum of every token bucket. */
  tokens: number;
  runs: number;
}

export interface UsageProjectRow {
  projectId: string;
  /** Null when the project was deleted. */
  projectName: string | null;
  costUsd: number;
  runs: number;
}

export interface UsageBreakdownRow {
  key: string;
  costUsd: number;
  tokens: number;
}

export interface UsageDailyRow {
  /** Calendar day, `YYYY-MM-DD`. */
  date: string;
  costUsd: number;
}

export interface UsagePersonRow {
  /** Email, or `USAGE_AUTOMATIC_USER`. */
  user: string;
  costUsd: number;
  tokens: number;
  runs: number;
  /** Drill-down: by project id, by model, and per day (dates of the range). */
  projects: UsageBreakdownRow[];
  models: UsageBreakdownRow[];
  daily: UsageDailyRow[];
}

export interface UsageModelRow {
  model: string;
  agentIds: UsageAgentId[];
  runs: number;
  tokens: UsageTokens;
  costUsd: number;
}

export interface UsagePrice {
  model: string;
  /** USD per 1M tokens. */
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  /** First day (`YYYY-MM-DD`) this price applies. */
  effectiveFrom: string;
}

export interface UsageSummaryResponse {
  query: UsageQuery;
  totals: UsageTotals;
  /** Present only when a comparison period was requested and has records. */
  compareTotals: UsageTotals | null;
  /** Sorted by cost, descending. */
  projects: UsageProjectRow[];
  /** Sorted by cost, descending. */
  people: UsagePersonRow[];
  /** Every day of the range, zero-filled, split by model. */
  daily: Array<UsageDailyRow & { byModel: Record<string, number> }>;
  /** Comparison period per day, aligned by position with `daily`. */
  compareDaily: UsageDailyRow[] | null;
  /** Sorted by cost, descending. */
  models: UsageModelRow[];
  modelTokenTotals: UsageTokens;
  /** Prices used anywhere in the range, newest first per model. */
  prices: UsagePrice[];
  /** Models that had usage but no price; their cost counts as 0. */
  unpricedModels: string[];
  /** First day any usage was recorded, or null when nothing is recorded. */
  recordedSince: string | null;
}

/** One CSV row of `GET /api/usage/export`, in column order. */
export const USAGE_EXPORT_COLUMNS = [
  'date',
  'time',
  'projectId',
  'projectName',
  'user',
  'agentId',
  'model',
  'runId',
  'input',
  'cacheWrite5m',
  'cacheWrite1h',
  'cacheRead',
  'output',
  'costUsd',
] as const;
