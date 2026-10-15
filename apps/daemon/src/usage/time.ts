/** Calendar days for usage statistics are Asia/Taipei (UTC+8, no DST). */
const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;

export function taipeiDay(ts: number): string {
  return new Date(ts + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

export function taipeiTime(ts: number): string {
  return new Date(ts + TAIPEI_OFFSET_MS).toISOString().slice(11, 19);
}

export function isValidDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every day from `from` to `to` inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
