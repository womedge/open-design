import { describe, expect, it } from 'vitest';

import {
  computeDelta,
  formatInt,
  formatPrice,
  formatShare,
  formatTokens,
  formatUsd,
  modelDisplayName,
} from '../../../src/components/usage/usage-format';

describe('formatTokens', () => {
  it('prints 0 as a bare 0', () => {
    expect(formatTokens(0)).toBe('0');
  });
  it('uses 萬 below one 億, with the unit inside the value', () => {
    expect(formatTokens(82_000_000)).toBe('8,200 萬');
    expect(formatTokens(35_000)).toBe('3.5 萬');
    expect(formatTokens(99_940_000)).toBe('9,994 萬');
  });
  it('switches to 億 at 1 億 and keeps one decimal', () => {
    expect(formatTokens(100_000_000)).toBe('1.0 億');
    expect(formatTokens(1_230_000_000)).toBe('12.3 億');
  });
  it('rolls a value that rounds up to 10,000 萬 into 億', () => {
    expect(formatTokens(99_999_999)).toBe('1.0 億');
  });
  it('shows amounts below 1 萬 as plain integers', () => {
    expect(formatTokens(54)).toBe('54');
    expect(formatTokens(9_460)).toBe('9,460');
    expect(formatTokens(9_999.6)).toBe('1 萬');
    expect(formatTokens(10_000)).toBe('1 萬');
  });
});

describe('formatUsd / formatPrice / formatShare', () => {
  it('formats money with thousands separators and two decimals', () => {
    expect(formatUsd(50.8)).toBe('US$50.80');
    expect(formatUsd(1234.5)).toBe('US$1,234.50');
  });
  it('keeps the third decimal only when it matters', () => {
    expect(formatPrice(0.125)).toBe('$0.125');
    expect(formatPrice(4)).toBe('$4.00');
  });
  it('formats shares and survives a zero total', () => {
    expect(formatShare(19.59, 50.86)).toBe('38.5%');
    expect(formatShare(1, 0)).toBe('0.0%');
  });
});

describe('computeDelta', () => {
  it('rounds to a whole percent with a sign', () => {
    expect(computeDelta(50.86, 41.35)).toMatchObject({ percent: 23, direction: 'up', text: '+23%' });
    expect(computeDelta(30, 40)).toMatchObject({ percent: -25, direction: 'down', text: '-25%' });
  });
  it('reports flat for no change', () => {
    expect(computeDelta(10, 10)).toMatchObject({ direction: 'flat', text: '0%' });
  });
  it('has no delta without a usable base', () => {
    expect(computeDelta(10, 0)).toBeNull();
    expect(computeDelta(10, null)).toBeNull();
    expect(computeDelta(10, undefined)).toBeNull();
  });
});

describe('modelDisplayName', () => {
  it('prettifies known id shapes and passes unknown ones through', () => {
    expect(modelDisplayName('claude-opus-5-5')).toBe('Claude Opus 5.5');
    expect(modelDisplayName('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5');
    expect(modelDisplayName('gpt-5.5')).toBe('GPT-5.5');
    expect(modelDisplayName('mystery')).toBe('mystery');
  });
});

describe('formatInt (明細 token cells)', () => {
  it('prints full integers with thousands separators and no 萬/億', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(6)).toBe('6');
    expect(formatInt(1_739)).toBe('1,739');
    expect(formatInt(57_000)).toBe('57,000');
    expect(formatInt(110_345_678)).toBe('110,345,678');
  });
});
