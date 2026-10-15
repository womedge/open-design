import { describe, expect, it } from 'vitest';
import { computeCost, normalizeModelId, priceFor, type PriceTable } from '../../src/usage/pricing.js';

const tokens = (o: Partial<Record<'input' | 'cacheWrite5m' | 'cacheWrite1h' | 'cacheRead' | 'output', number>>) => ({
  input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, ...o,
});

describe('pricing', () => {
  it('uses the price effective on the day of use', () => {
    const table: PriceTable = {
      models: {
        'claude-sonnet-5-5': {
          prices: [
            { effectiveFrom: '2026-01-01', input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
            { effectiveFrom: '2026-11-01', input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 },
          ],
        },
      },
    };
    const t = tokens({ input: 1_000_000 });
    expect(computeCost('claude-sonnet-5-5', '2026-10-31', t, null, table).costUsd).toBeCloseTo(2);
    expect(computeCost('claude-sonnet-5-5', '2026-11-01', t, null, table).costUsd).toBeCloseTo(3);
    expect(computeCost('claude-sonnet-5-5', '2026-10-31', t, null, table).priceEffectiveFrom).toBe('2026-01-01');
  });

  it('Opus 5.5: 1h write = 2x input, cache read 0.05x input', () => {
    const p = priceFor('claude-opus-5-5', '2026-10-15')!;
    expect(p.cacheWrite1h).toBe(p.input * 2);
    expect(p.cacheRead).toBeCloseTo(p.input * 0.05);
  });

  it('fast speed multiplies every bucket', () => {
    const t = tokens({ input: 1_000_000, cacheRead: 1_000_000, output: 1_000_000 });
    const base = computeCost('claude-opus-5-5', '2026-10-15', t).costUsd;
    expect(computeCost('claude-opus-5-5', '2026-10-15', t, 'fast').costUsd).toBeCloseTo(base * 2);
  });

  it('Haiku 5.5 long-context tier is judged per message, whole message at the tier', () => {
    const small = computeCost('claude-haiku-5-5', '2026-10-15', tokens({ cacheRead: 100_000, output: 1000 }));
    const big = computeCost('claude-haiku-5-5', '2026-10-15', tokens({ cacheRead: 100_001, output: 1000 }));
    expect(small.costUsd).toBeCloseTo((100_000 * 0.01 + 1000 * 0.5) / 1e6);
    expect(big.costUsd).toBeCloseTo((100_001 * 0.05 + 1000 * 2.5) / 1e6);
    // Two sub-threshold messages never trip the tier even though their sum would.
    const two = 2 * computeCost('claude-haiku-5-5', '2026-10-15', tokens({ cacheRead: 60_000 })).costUsd;
    expect(two).toBeCloseTo((120_000 * 0.01) / 1e6);
  });

  it('GPT long context (>272K) doubles input/cached and 1.5x output', () => {
    const c = computeCost('gpt-5.5', '2026-10-15', tokens({ input: 272_001, output: 1_000_000 }));
    expect(c.costUsd).toBeCloseTo((272_001 * 10 + 1_000_000 * 45) / 1e6);
  });

  it('unknown model costs 0 and is flagged unpriced', () => {
    const c = computeCost('mystery-model', '2026-10-15', tokens({ input: 1_000_000 }));
    expect(c).toEqual({ costUsd: 0, priceEffectiveFrom: null, priced: false });
  });

  it('normalizes vendor ids', () => {
    expect(normalizeModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(normalizeModelId('anthropic/claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(normalizeModelId('claude-opus-5.5[1m]')).toBe('claude-opus-5-5');
    expect(normalizeModelId('openai/gpt-5.5')).toBe('gpt-5.5');
  });
});
