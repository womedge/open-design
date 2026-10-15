import { describe, expect, it } from 'vitest';

import { buildProjectLabels, plainProjectLabel } from '../../../src/components/usage/usage-project-labels';

const dict: Record<string, string> = {
  'usage.noProject': '未指定專案',
  'usage.deletedProject': '已刪除專案',
  'usage.deletedOption': '{name}（已刪除）',
};
const t = ((key: string, vars?: Record<string, string>) =>
  (dict[key] ?? key).replace('{name}', vars?.name ?? '')) as never;
const at = (iso: string) => Date.parse(iso);
const live = (id: string, name: string | null) => ({ id, name, deleted: false });
const gone = (id: string, name: string | null) => ({ id, name, deleted: true });
const text = (m: Map<string, { text: string }>, id: string) => m.get(id)!.text;

describe('buildProjectLabels', () => {
  it('leaves unique live names alone', () => {
    const l = buildProjectLabels([live('a', 'Alpha'), live('b', 'Beta')], new Map(), t);
    expect(text(l, 'a')).toBe('Alpha');
    expect(l.get('a')!.deleted).toBe(false);
    expect(text(l, 'b')).toBe('Beta');
  });

  it('appends the creation date (Taipei) to live projects that share a name', () => {
    const l = buildProjectLabels(
      [live('a', 'Website Clone'), live('b', 'Website Clone')],
      new Map([['a', at('2026-10-13T16:30:00Z')], ['b', at('2026-10-20T01:00:00Z')]]),
      t,
    );
    expect(text(l, 'a')).toBe('Website Clone · 10/14');
    expect(text(l, 'b')).toBe('Website Clone · 10/20');
  });

  it('adds the year only when the dates fall in different years', () => {
    const l = buildProjectLabels(
      [live('a', 'X'), live('b', 'X')],
      new Map([['a', at('2025-12-30T04:00:00Z')], ['b', at('2026-01-05T04:00:00Z')]]),
      t,
    );
    expect(text(l, 'a')).toBe('X · 2025/12/30');
    expect(text(l, 'b')).toBe('X · 2026/1/5');
  });

  it('adds the time when two were created on the same day', () => {
    const l = buildProjectLabels(
      [live('a', 'X'), live('b', 'X')],
      new Map([['a', at('2026-10-14T06:05:00Z')], ['b', at('2026-10-14T09:30:00Z')]]),
      t,
    );
    expect(text(l, 'a')).toBe('X · 10/14 14:05');
    expect(text(l, 'b')).toBe('X · 10/14 17:30');
  });

  it('keeps the bare name when a creation date is unknown', () => {
    const l = buildProjectLabels(
      [live('a', 'X'), live('b', 'X')],
      new Map([['a', at('2026-10-14T06:05:00Z')]]),
      t,
    );
    expect(text(l, 'b')).toBe('X');
  });

  it('keeps the original name of a deleted project and flags it', () => {
    const l = buildProjectLabels([gone('gone-1', 'Old Site'), live('a', 'New Site')], new Map(), t);
    expect(l.get('gone-1')).toEqual({ text: 'Old Site', deleted: true, nameless: false });
    expect(plainProjectLabel(l.get('gone-1')!, t)).toBe('Old Site（已刪除）');
    expect(plainProjectLabel(l.get('a')!, t)).toBe('New Site');
  });

  it('tells deleted projects with the same name apart by the id tail, not by date', () => {
    const l = buildProjectLabels(
      [gone('proj-aaaa3f9a', 'Old'), gone('proj-bbbb71c2', 'Old')],
      new Map([['proj-aaaa3f9a', at('2026-10-14T06:05:00Z')]]),
      t,
    );
    expect(text(l, 'proj-aaaa3f9a')).toBe('Old · 3f9a');
    expect(text(l, 'proj-bbbb71c2')).toBe('Old · 71c2');
  });

  it('does not mix a deleted project with a live one of the same name', () => {
    const l = buildProjectLabels([gone('x1', 'Same'), live('x2', 'Same')], new Map(), t);
    expect(text(l, 'x1')).toBe('Same');
    expect(text(l, 'x2')).toBe('Same');
  });

  it('falls back to 已刪除專案 only for nameless deleted projects, with an id tail when several', () => {
    const one = buildProjectLabels([gone('abcd1234', null)], new Map(), t);
    expect(one.get('abcd1234')).toEqual({ text: '已刪除專案', deleted: true, nameless: true });
    expect(plainProjectLabel(one.get('abcd1234')!, t)).toBe('已刪除專案');
    const two = buildProjectLabels([gone('abcd1234', null), gone('wxyz9876', null)], new Map(), t);
    expect(text(two, 'abcd1234')).toBe('已刪除專案 · 1234');
    expect(text(two, 'wxyz9876')).toBe('已刪除專案 · 9876');
  });

  it('labels unassigned runs 未指定專案 and never treats a null name alone as deleted', () => {
    const l = buildProjectLabels([live('__none__', null)], new Map(), t);
    expect(l.get('__none__')).toEqual({ text: '未指定專案', deleted: false, nameless: false });
  });
});
