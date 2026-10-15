import type { UsageSummaryResponse } from '@open-design/contracts';
import { useT } from '../../i18n';

export type TKey = Parameters<ReturnType<typeof useT>>[0];

/** Model → stack/legend color, in the order the summary lists models. */
const MODEL_COLORS = [
  'var(--text-strong)',
  'var(--green)',
  'var(--blue)',
  'var(--amber)',
  'var(--red)',
  'color-mix(in srgb, var(--blue) 55%, var(--red))',
  'color-mix(in srgb, var(--green) 60%, var(--blue))',
  'var(--text-soft)',
];

export function buildModelColors(models: Array<{ model: string }>): Map<string, string> {
  const map = new Map<string, string>();
  models.forEach((m, i) => map.set(m.model, MODEL_COLORS[i % MODEL_COLORS.length]!));
  return map;
}

export function colorOfModel(colors: Map<string, string>, model: string): string {
  return colors.get(model) ?? MODEL_COLORS[MODEL_COLORS.length - 1]!;
}

/** Day totals of the whole stack, one number per day. */
export function dailyTotals(summary: UsageSummaryResponse): number[] {
  return summary.daily.map((d) => d.costUsd);
}

/** A y-axis ceiling (three equal steps) that is a "nice" number. */
export function niceAxis(max: number): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 3, ticks: [1, 2, 3] };
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = [1, 2, 2.5, 5, 10].find((u) => u * pow >= raw)! * pow;
  const step = Number(unit.toPrecision(6));
  return { top: step * 3, ticks: [step, step * 2, step * 3] };
}

export function userInitial(user: string): string {
  return (user.trim().charAt(0) || '?').toUpperCase();
}

/** Filter / row key for runs that belong to no project (matches the daemon). */
export const USAGE_NO_PROJECT_ID = '__none__';

/** The API refuses ranges longer than this many days. */
export const USAGE_MAX_RANGE_DAYS = 1100;

/** Row / option label for a project: unassigned runs and deleted projects read differently. */
export function projectLabel(
  id: string,
  name: string | null,
  t: (key: TKey) => string,
): string {
  if (id === USAGE_NO_PROJECT_ID) return t('usage.noProject');
  return name ?? t('usage.deletedProject');
}
