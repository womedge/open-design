// Date arithmetic for the usage page. Every day is a calendar day in
// Asia/Taipei, handled as an integer "day serial" (days since the Unix epoch
// of that calendar date) so month/year shifts never touch the machine's own
// time zone or DST rules.

const DAY_MS = 86_400_000;
const TAIPEI = 'Asia/Taipei';

export type UsageDay = number;

export type UsagePresetId =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'lastMonth'
  | 'thisMonth'
  | 'thisYear'
  | 'custom';

export type UsageCompareType = 'previous' | 'yearAgo' | 'custom';

export type UsageCompareLabelKey =
  | 'usage.vsLastMonth'
  | 'usage.vsPrevious'
  | 'usage.vsLastYear'
  | 'usage.vsCustom';

export interface UsageRangeState {
  preset: UsagePresetId;
  from: UsageDay;
  to: UsageDay;
  cmpOn: boolean;
  cmpType: UsageCompareType;
  /** Only read when `cmpType === 'custom'`. */
  cmpFrom: UsageDay;
  cmpTo: UsageDay;
}

export interface UsageDayRange {
  from: UsageDay;
  to: UsageDay;
}

export function daySerial(year: number, month0: number, day: number): UsageDay {
  return Math.round(Date.UTC(year, month0, day) / DAY_MS);
}

export interface DayParts {
  year: number;
  month0: number;
  day: number;
  weekday: number;
}

export function dayParts(serial: UsageDay): DayParts {
  const d = new Date(serial * DAY_MS);
  return {
    year: d.getUTCFullYear(),
    month0: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
  };
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** `YYYY-MM-DD`, the wire format of the usage API. */
export function toIso(serial: UsageDay): string {
  const p = dayParts(serial);
  return `${p.year}-${pad2(p.month0 + 1)}-${pad2(p.day)}`;
}

export function fromIso(iso: string): UsageDay {
  const [y, m, d] = iso.split('-').map(Number);
  return daySerial(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** `YYYY/MM/DD`, how the picker prints a day. */
export function formatDay(serial: UsageDay): string {
  const p = dayParts(serial);
  return `${p.year}/${pad2(p.month0 + 1)}/${pad2(p.day)}`;
}

export function formatRange(range: UsageDayRange): string {
  return `${formatDay(range.from)} ~ ${formatDay(range.to)}`;
}

/** `MM/DD` — the chart's axis label. */
export function formatShortDay(serial: UsageDay): string {
  const p = dayParts(serial);
  return `${pad2(p.month0 + 1)}/${pad2(p.day)}`;
}

/** Today's calendar day in Asia/Taipei, whatever the machine's own zone. */
export function todayInTaipei(now: Date = new Date()): UsageDay {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return daySerial(pick('year'), pick('month') - 1, pick('day'));
}

/** Move by whole months, clamping the day (Mar 31 − 1 month → Feb 28/29). */
export function shiftMonths(serial: UsageDay, delta: number): UsageDay {
  const p = dayParts(serial);
  const total = p.month0 + delta;
  const year = p.year + Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  return daySerial(year, month0, Math.min(p.day, daysInMonth(year, month0)));
}

export function shiftYears(serial: UsageDay, delta: number): UsageDay {
  const p = dayParts(serial);
  const year = p.year + delta;
  return daySerial(year, p.month0, Math.min(p.day, daysInMonth(year, p.month0)));
}

export function monthStart(serial: UsageDay): UsageDay {
  const p = dayParts(serial);
  return daySerial(p.year, p.month0, 1);
}

export function monthEnd(serial: UsageDay): UsageDay {
  const p = dayParts(serial);
  return daySerial(p.year, p.month0, daysInMonth(p.year, p.month0));
}

export function dayCount(range: UsageDayRange): number {
  return range.to - range.from + 1;
}

export function presetRange(
  preset: Exclude<UsagePresetId, 'custom'>,
  today: UsageDay,
): UsageDayRange {
  const p = dayParts(today);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: today - 1, to: today - 1 };
    case 'last7':
      return { from: today - 6, to: today };
    case 'last30':
      return { from: today - 29, to: today };
    case 'lastMonth': {
      const first = shiftMonths(monthStart(today), -1);
      return { from: first, to: monthEnd(first) };
    }
    case 'thisMonth':
      return { from: daySerial(p.year, p.month0, 1), to: today };
    case 'thisYear':
      return { from: daySerial(p.year, 0, 1), to: today };
  }
}

/** The page opens on 本月累計, compared with the same days of last month. */
export function defaultRangeState(today: UsageDay): UsageRangeState {
  const range = presetRange('thisMonth', today);
  const cmp = compareRangeFor({ preset: 'thisMonth', ...range, cmpType: 'previous' });
  return {
    preset: 'thisMonth',
    ...range,
    cmpOn: true,
    cmpType: 'previous',
    cmpFrom: cmp.from,
    cmpTo: cmp.to,
  };
}

export interface CompareRangeInput {
  preset: UsagePresetId;
  from: UsageDay;
  to: UsageDay;
  cmpType: UsageCompareType;
  cmpFrom?: UsageDay;
  cmpTo?: UsageDay;
}

/**
 * The comparison period and the wording that names it. 本月累計 / 上個月 compare
 * with the same days of the previous month; other presets compare with the
 * equally long stretch right before.
 */
export function compareRangeFor(input: CompareRangeInput): UsageDayRange & {
  labelKey: UsageCompareLabelKey;
} {
  if (input.cmpType === 'custom') {
    return {
      from: input.cmpFrom ?? input.from,
      to: input.cmpTo ?? input.to,
      labelKey: 'usage.vsCustom',
    };
  }
  if (input.cmpType === 'yearAgo') {
    return {
      from: shiftYears(input.from, -1),
      to: shiftYears(input.to, -1),
      labelKey: 'usage.vsLastYear',
    };
  }
  if (input.preset === 'thisMonth') {
    return {
      from: shiftMonths(input.from, -1),
      to: shiftMonths(input.to, -1),
      labelKey: 'usage.vsLastMonth',
    };
  }
  if (input.preset === 'lastMonth') {
    const from = shiftMonths(input.from, -1);
    return { from, to: monthEnd(from), labelKey: 'usage.vsLastMonth' };
  }
  if (input.preset === 'thisYear') {
    return {
      from: shiftYears(input.from, -1),
      to: shiftYears(input.to, -1),
      labelKey: 'usage.vsLastYear',
    };
  }
  const n = input.to - input.from + 1;
  return { from: input.from - n, to: input.from - 1, labelKey: 'usage.vsPrevious' };
}

export function compareRangeOf(state: UsageRangeState) {
  return compareRangeFor(state);
}

export const PRESET_LABEL_KEY: Record<UsagePresetId, string> = {
  today: 'usage.presetToday',
  yesterday: 'usage.presetYesterday',
  last7: 'usage.presetLast7',
  last30: 'usage.presetLast30',
  lastMonth: 'usage.presetLastMonth',
  thisMonth: 'usage.presetThisMonth',
  thisYear: 'usage.presetThisYear',
  custom: 'usage.presetCustom',
};

export const PRESET_ORDER: UsagePresetId[] = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'lastMonth',
  'thisMonth',
  'thisYear',
  'custom',
];

/**
 * Presets are relative to "today"; when the Taipei day rolls over while the
 * page stays open, move a preset-based range along with it. Custom ranges stay.
 */
export function rederiveRange(state: UsageRangeState, today: UsageDay): UsageRangeState {
  if (state.preset === 'custom') return state;
  const range = presetRange(state.preset, today);
  if (range.from === state.from && range.to === state.to) return state;
  const cmp = compareRangeFor({ ...state, ...range });
  const keepCustomCompare = state.cmpType === 'custom';
  return {
    ...state,
    ...range,
    cmpFrom: keepCustomCompare ? state.cmpFrom : cmp.from,
    cmpTo: keepCustomCompare ? state.cmpTo : cmp.to,
  };
}

/** The range between `anchor` and `day`, cut so it never exceeds `maxDays` (the end the user clicked gives way). */
export function spanBetween(anchor: UsageDay, day: UsageDay, maxDays: number): UsageDayRange {
  if (day >= anchor) return { from: anchor, to: Math.min(day, anchor + maxDays - 1) };
  return { from: Math.max(day, anchor - maxDays + 1), to: anchor };
}
