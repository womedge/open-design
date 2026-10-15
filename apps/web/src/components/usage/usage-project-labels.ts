import { USAGE_NO_PROJECT_ID, type TKey } from './usage-model';

export interface UsageProjectRef {
  id: string;
  /** Null when the project was deleted. */
  name: string | null;
}

interface TaipeiStamp {
  year: number;
  month: number;
  day: number;
  hour: string;
  minute: string;
}

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function stamp(ms: number): TaipeiStamp {
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/**
 * Display labels for projects. Names that are unique stay as they are; projects
 * sharing a name get their creation date (Asia/Taipei) appended — `10/14`, with
 * the year when the group spans several years, and `10/14 14:05` when two of
 * them were created on the same day. Deleted and unassigned projects use the
 * usual fallback labels and never take part in disambiguation.
 */
export function buildProjectLabels(
  projects: UsageProjectRef[],
  createdAt: ReadonlyMap<string, number>,
  t: (key: TKey) => string,
): Map<string, string> {
  const labels = new Map<string, string>();
  const groups = new Map<string, string[]>();
  const deleted = projects.filter((p) => p.name === null && p.id !== USAGE_NO_PROJECT_ID);
  const tellDeletedApart = new Set(deleted.map((p) => p.id)).size > 1;
  for (const p of projects) {
    if (p.id === USAGE_NO_PROJECT_ID) {
      labels.set(p.id, t('usage.noProject'));
    } else if (p.name === null) {
      // Several deleted projects read the same; the id tail tells them apart.
      labels.set(p.id, tellDeletedApart ? `${t('usage.deletedProject')} · ${p.id.slice(-4)}` : t('usage.deletedProject'));
    } else {
      labels.set(p.id, p.name);
      const ids = groups.get(p.name) ?? [];
      if (!ids.includes(p.id)) ids.push(p.id);
      groups.set(p.name, ids);
    }
  }
  for (const [name, ids] of groups) {
    if (ids.length < 2) continue;
    const stamps = new Map<string, TaipeiStamp>();
    for (const id of ids) {
      const ms = createdAt.get(id);
      if (ms !== undefined) stamps.set(id, stamp(ms));
    }
    const all = [...stamps.values()];
    const multiYear = new Set(all.map((s) => s.year)).size > 1;
    const dayKey = (s: TaipeiStamp) => `${s.year}-${s.month}-${s.day}`;
    const sameDay = new Set(all.map(dayKey)).size < all.length;
    for (const [id, s] of stamps) {
      const date = `${multiYear ? `${s.year}/` : ''}${s.month}/${s.day}`;
      labels.set(id, `${name} · ${date}${sameDay ? ` ${s.hour}:${s.minute}` : ''}`);
    }
  }
  return labels;
}

export function labelOf(labels: ReadonlyMap<string, string>, id: string, fallback: string): string {
  return labels.get(id) ?? fallback;
}
