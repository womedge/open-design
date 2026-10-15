import { USAGE_NO_PROJECT_ID, type TKey } from './usage-model';

export interface UsageProjectRef {
  id: string;
  /** The live name, or the name snapshotted before deletion. Null when none was ever recorded. */
  name: string | null;
  /** True when the project no longer exists. */
  deleted: boolean;
}

export interface UsageProjectLabel {
  /** The name to show. */
  text: string;
  deleted: boolean;
  /** Deleted and never named: the text itself already says "deleted". */
  nameless: boolean;
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

const tail = (id: string) => id.slice(-4);

/**
 * Labels for projects, keyed by project id.
 * - Unassigned runs read 未指定專案.
 * - Live projects sharing a name get their creation date (Asia/Taipei):
 *   `10/14`, with the year when they span years, plus the time when two were
 *   created on the same day.
 * - Deleted projects keep their original name (drawn struck through by the
 *   caller); several with the same name get the last 4 characters of the id.
 *   A deleted project that never had a name reads 已刪除專案, with the same
 *   id tail when several are nameless.
 */
export function buildProjectLabels(
  projects: UsageProjectRef[],
  createdAt: ReadonlyMap<string, number>,
  t: (key: TKey) => string,
): Map<string, UsageProjectLabel> {
  const labels = new Map<string, UsageProjectLabel>();
  const live = new Map<string, string[]>();
  const gone = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, id: string) => {
    const ids = map.get(key) ?? [];
    if (!ids.includes(id)) ids.push(id);
    map.set(key, ids);
  };
  const NAMELESS = '\u0000nameless';

  for (const p of projects) {
    if (p.id === USAGE_NO_PROJECT_ID) {
      labels.set(p.id, { text: t('usage.noProject'), deleted: false, nameless: false });
    } else if (p.deleted) {
      if (p.name === null) {
        labels.set(p.id, { text: t('usage.deletedProject'), deleted: true, nameless: true });
        add(gone, NAMELESS, p.id);
      } else {
        labels.set(p.id, { text: p.name, deleted: true, nameless: false });
        add(gone, p.name, p.id);
      }
    } else {
      const text = p.name ?? p.id;
      labels.set(p.id, { text, deleted: false, nameless: false });
      add(live, text, p.id);
    }
  }

  for (const ids of gone.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const l = labels.get(id)!;
      labels.set(id, { ...l, text: `${l.text} · ${tail(id)}` });
    }
  }

  for (const [name, ids] of live) {
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
      labels.set(id, {
        text: `${name} · ${date}${sameDay ? ` ${s.hour}:${s.minute}` : ''}`,
        deleted: false,
        nameless: false,
      });
    }
  }
  return labels;
}

/** Plain-text form for places that cannot be styled (select options). */
export function plainProjectLabel(
  label: UsageProjectLabel,
  t: (key: TKey, vars?: Record<string, string | number>) => string,
): string {
  return label.deleted && !label.nameless ? t('usage.deletedOption', { name: label.text }) : label.text;
}
