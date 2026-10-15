import type { UsagePrice, UsageTokens } from '@open-design/contracts';
import pricesJson from './prices.json' with { type: 'json' };

/**
 * Price table lookup and per-message cost. Rates live in `prices.json` (see its
 * header for the sources). Cost is computed ONCE when a usage record is
 * written, with the price in effect on that Asia/Taipei day, and stored; it is
 * never recomputed when the table changes.
 */

export interface LongContextRates {
  thresholdTokens: number;
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface PriceEntry {
  effectiveFrom: string;
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
  fastMultiplier?: number;
  longContext?: LongContextRates;
}

export interface PriceTable {
  models: Record<string, { verified?: boolean; prices: PriceEntry[] }>;
}

const TABLE = pricesJson as unknown as PriceTable;

/**
 * Collapse a vendor model id to the key used in the price table and stored on
 * records: lower-case, no provider prefix, no `[1m]`/`@version` suffix, no date
 * stamp (`claude-haiku-4-5-20251001` -> `claude-haiku-4-5`).
 */
export function normalizeModelId(raw: string | null | undefined): string {
  let id = String(raw ?? '').trim().toLowerCase();
  if (!id) return 'unknown';
  id = id.replace(/\[[^\]]*\]$/, '');
  const slash = id.lastIndexOf('/');
  if (slash >= 0) id = id.slice(slash + 1);
  id = id.replace(/@.*$/, '');
  id = id.replace(/-latest$/, '');
  id = id.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '');
  if (id.startsWith('claude-')) id = id.replace(/(\d)\.(\d)/g, '$1-$2');
  return id || 'unknown';
}

function entriesFor(model: string, table: PriceTable = TABLE): PriceEntry[] | null {
  const hit = table.models[normalizeModelId(model)];
  if (!hit) return null;
  return [...hit.prices].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** Price in effect on `day`; before the first entry the earliest one applies. */
export function priceFor(model: string, day: string, table: PriceTable = TABLE): PriceEntry | null {
  const entries = entriesFor(model, table);
  if (!entries || entries.length === 0) return null;
  let chosen = entries[0]!;
  for (const e of entries) if (e.effectiveFrom <= day) chosen = e;
  return chosen;
}

export function isPricedModel(model: string): boolean {
  return entriesFor(model) !== null;
}

export interface CostResult {
  costUsd: number;
  /** Null when the model is unknown (cost 0). */
  priceEffectiveFrom: string | null;
  priced: boolean;
}

export function totalTokens(t: UsageTokens): number {
  return t.input + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead + t.output;
}

export function computeCost(
  model: string,
  day: string,
  tokens: UsageTokens,
  speed?: string | null,
  table: PriceTable = TABLE,
): CostResult {
  const price = priceFor(model, day, table);
  if (!price) return { costUsd: 0, priceEffectiveFrom: null, priced: false };
  // Long context is judged per message: prompt = input + cache read + writes.
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite5m + tokens.cacheWrite1h;
  const lc = price.longContext;
  const rates = lc && prompt > lc.thresholdTokens ? lc : price;
  let cost =
    (tokens.input * rates.input +
      tokens.cacheWrite5m * rates.cacheWrite5m +
      tokens.cacheWrite1h * rates.cacheWrite1h +
      tokens.cacheRead * rates.cacheRead +
      tokens.output * rates.output) /
    1_000_000;
  if (speed === 'fast' && price.fastMultiplier && price.fastMultiplier > 1) {
    cost *= price.fastMultiplier;
  }
  return { costUsd: cost, priceEffectiveFrom: price.effectiveFrom, priced: true };
}

/**
 * Prices that applied anywhere in [from, to] for `models`, newest first per
 * model, flattened to the contract shape (base rates).
 */
export function pricesUsedInRange(models: string[], from: string, to: string): UsagePrice[] {
  const out: UsagePrice[] = [];
  for (const model of [...new Set(models)].sort()) {
    const entries = entriesFor(model);
    if (!entries) continue;
    const key = normalizeModelId(model);
    const inRange = entries.filter((e, i) => {
      const next = entries[i + 1];
      return e.effectiveFrom <= to && (!next || next.effectiveFrom > from);
    });
    for (const e of inRange.reverse()) {
      out.push({
        model: key,
        input: e.input,
        cacheWrite5m: e.cacheWrite5m,
        cacheWrite1h: e.cacheWrite1h,
        cacheRead: e.cacheRead,
        output: e.output,
        effectiveFrom: e.effectiveFrom,
      });
    }
  }
  return out;
}
