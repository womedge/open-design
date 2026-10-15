import { describe, expect, it } from 'vitest';

import {
  compareRangeFor,
  daySerial,
  defaultRangeState,
  presetRange,
  rederiveRange,
  spanBetween,
  toIso,
  todayInTaipei,
} from '../../../src/components/usage/usage-dates';

const d = (y: number, m: number, day: number) => daySerial(y, m - 1, day);
const iso = (r: { from: number; to: number }) => [toIso(r.from), toIso(r.to)];

describe('todayInTaipei', () => {
  it('uses the Taipei calendar day, not the UTC one', () => {
    // 16:30 UTC on Sep 30 is already 00:30 on Oct 1 in Taipei (UTC+8).
    expect(toIso(todayInTaipei(new Date('2026-09-30T16:30:00Z')))).toBe('2026-10-01');
    expect(toIso(todayInTaipei(new Date('2026-09-30T15:59:00Z')))).toBe('2026-09-30');
  });
  it('rolls the year at Taipei midnight', () => {
    expect(toIso(todayInTaipei(new Date('2026-12-31T16:00:00Z')))).toBe('2027-01-01');
  });
});

describe('presetRange', () => {
  const today = d(2026, 10, 15);
  it('covers the fixed windows', () => {
    expect(iso(presetRange('today', today))).toEqual(['2026-10-15', '2026-10-15']);
    expect(iso(presetRange('yesterday', today))).toEqual(['2026-10-14', '2026-10-14']);
    expect(iso(presetRange('last7', today))).toEqual(['2026-10-09', '2026-10-15']);
    expect(iso(presetRange('last30', today))).toEqual(['2026-09-16', '2026-10-15']);
    expect(iso(presetRange('thisMonth', today))).toEqual(['2026-10-01', '2026-10-15']);
    expect(iso(presetRange('thisYear', today))).toEqual(['2026-01-01', '2026-10-15']);
  });
  it('handles 上個月 across month and year boundaries', () => {
    expect(iso(presetRange('lastMonth', today))).toEqual(['2026-09-01', '2026-09-30']);
    expect(iso(presetRange('lastMonth', d(2027, 1, 1)))).toEqual(['2026-12-01', '2026-12-31']);
    expect(iso(presetRange('lastMonth', d(2028, 3, 10)))).toEqual(['2028-02-01', '2028-02-29']);
  });
  it('on the 1st, 本月累計 is a single day', () => {
    expect(iso(presetRange('thisMonth', d(2026, 11, 1)))).toEqual(['2026-11-01', '2026-11-01']);
  });
});

describe('compareRangeFor', () => {
  it('compares 本月累計 with the same days of last month', () => {
    const r = compareRangeFor({ preset: 'thisMonth', ...presetRange('thisMonth', d(2026, 10, 15)), cmpType: 'previous' });
    expect(iso(r)).toEqual(['2026-09-01', '2026-09-15']);
    expect(r.labelKey).toBe('usage.vsLastMonth');
  });
  it('clamps the end day when last month is shorter', () => {
    const r = compareRangeFor({ preset: 'thisMonth', ...presetRange('thisMonth', d(2026, 3, 31)), cmpType: 'previous' });
    expect(iso(r)).toEqual(['2026-02-01', '2026-02-28']);
  });
  it('compares 上個月 with the whole month before it', () => {
    const r = compareRangeFor({ preset: 'lastMonth', ...presetRange('lastMonth', d(2026, 3, 15)), cmpType: 'previous' });
    expect(iso(r)).toEqual(['2026-01-01', '2026-01-31']);
    const jan = compareRangeFor({ preset: 'lastMonth', ...presetRange('lastMonth', d(2027, 1, 20)), cmpType: 'previous' });
    expect(iso(jan)).toEqual(['2026-11-01', '2026-11-30']);
  });
  it('compares other presets with the equally long stretch right before', () => {
    const r = compareRangeFor({ preset: 'last7', ...presetRange('last7', d(2026, 10, 15)), cmpType: 'previous' });
    expect(iso(r)).toEqual(['2026-10-02', '2026-10-08']);
    expect(r.labelKey).toBe('usage.vsPrevious');
    const single = compareRangeFor({ preset: 'today', ...presetRange('today', d(2026, 10, 15)), cmpType: 'previous' });
    expect(iso(single)).toEqual(['2026-10-14', '2026-10-14']);
  });
  it('supports 去年同時段, including Feb 29', () => {
    const r = compareRangeFor({ preset: 'custom', from: d(2028, 2, 29), to: d(2028, 3, 5), cmpType: 'yearAgo' });
    expect(iso(r)).toEqual(['2027-02-28', '2027-03-05']);
    expect(r.labelKey).toBe('usage.vsLastYear');
  });
  it('uses the picked range for 自訂', () => {
    const r = compareRangeFor({
      preset: 'last7', from: d(2026, 10, 9), to: d(2026, 10, 15), cmpType: 'custom',
      cmpFrom: d(2026, 8, 1), cmpTo: d(2026, 8, 7),
    });
    expect(iso(r)).toEqual(['2026-08-01', '2026-08-07']);
    expect(r.labelKey).toBe('usage.vsCustom');
  });
});

describe('defaultRangeState', () => {
  it('opens on 本月累計 compared with last month', () => {
    const s = defaultRangeState(d(2026, 10, 15));
    expect(s).toMatchObject({ preset: 'thisMonth', cmpOn: true, cmpType: 'previous' });
    expect([toIso(s.from), toIso(s.to)]).toEqual(['2026-10-01', '2026-10-15']);
    expect([toIso(s.cmpFrom), toIso(s.cmpTo)]).toEqual(['2026-09-01', '2026-09-15']);
  });
});

describe('rederiveRange', () => {
  it('moves a preset range across the Taipei day boundary', () => {
    const s = defaultRangeState(d(2026, 10, 31));
    const next = rederiveRange(s, d(2026, 11, 1));
    expect([toIso(next.from), toIso(next.to)]).toEqual(['2026-11-01', '2026-11-01']);
    expect([toIso(next.cmpFrom), toIso(next.cmpTo)]).toEqual(['2026-10-01', '2026-10-01']);
  });
  it('leaves custom ranges and unchanged days alone', () => {
    const s = { ...defaultRangeState(d(2026, 10, 15)), preset: 'custom' as const };
    expect(rederiveRange(s, d(2026, 10, 16))).toBe(s);
    const same = defaultRangeState(d(2026, 10, 15));
    expect(rederiveRange(same, d(2026, 10, 15))).toBe(same);
  });
});

describe('spanBetween', () => {
  it('orders the two days and caps the span', () => {
    expect(spanBetween(10, 5, 1100)).toEqual({ from: 5, to: 10 });
    expect(spanBetween(10, 5000, 1100)).toEqual({ from: 10, to: 1109 });
    expect(spanBetween(5000, 10, 1100)).toEqual({ from: 3901, to: 5000 });
  });
});
