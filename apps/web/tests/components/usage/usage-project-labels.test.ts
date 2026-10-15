import { describe, expect, it } from 'vitest';

import { buildProjectLabels } from '../../../src/components/usage/usage-project-labels';

const t = (key: string) => (key === 'usage.noProject' ? '未指定專案' : '已刪除專案');
const at = (iso: string) => Date.parse(iso);

describe('buildProjectLabels', () => {
  it('leaves unique names alone', () => {
    const labels = buildProjectLabels(
      [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
      new Map([['a', at('2026-10-14T00:00:00Z')]]),
      t as never,
    );
    expect(labels.get('a')).toBe('Alpha');
    expect(labels.get('b')).toBe('Beta');
  });

  it('appends the creation date (Taipei) to projects that share a name', () => {
    const labels = buildProjectLabels(
      [{ id: 'a', name: 'Website Clone' }, { id: 'b', name: 'Website Clone' }],
      // 16:30 UTC on Oct 13 is already Oct 14 in Taipei.
      new Map([['a', at('2026-10-13T16:30:00Z')], ['b', at('2026-10-20T01:00:00Z')]]),
      t as never,
    );
    expect(labels.get('a')).toBe('Website Clone · 10/14');
    expect(labels.get('b')).toBe('Website Clone · 10/20');
  });

  it('adds the year only when the dates fall in different years', () => {
    const labels = buildProjectLabels(
      [{ id: 'a', name: 'X' }, { id: 'b', name: 'X' }],
      new Map([['a', at('2025-12-30T04:00:00Z')], ['b', at('2026-01-05T04:00:00Z')]]),
      t as never,
    );
    expect(labels.get('a')).toBe('X · 2025/12/30');
    expect(labels.get('b')).toBe('X · 2026/1/5');
  });

  it('adds the time when two were created on the same day', () => {
    const labels = buildProjectLabels(
      [{ id: 'a', name: 'X' }, { id: 'b', name: 'X' }],
      new Map([['a', at('2026-10-14T06:05:00Z')], ['b', at('2026-10-14T09:30:00Z')]]),
      t as never,
    );
    expect(labels.get('a')).toBe('X · 10/14 14:05');
    expect(labels.get('b')).toBe('X · 10/14 17:30');
  });

  it('keeps deleted and unassigned projects out of the disambiguation', () => {
    const labels = buildProjectLabels(
      [{ id: '__none__', name: null }, { id: 'gone', name: null }, { id: 'a', name: 'X' }],
      new Map(),
      t as never,
    );
    expect(labels.get('__none__')).toBe('未指定專案');
    expect(labels.get('gone')).toBe('已刪除專案');
    expect(labels.get('a')).toBe('X');
  });

  it('falls back to the bare name when a creation date is unknown', () => {
    const labels = buildProjectLabels(
      [{ id: 'a', name: 'X' }, { id: 'b', name: 'X' }],
      new Map([['a', at('2026-10-14T06:05:00Z')]]),
      t as never,
    );
    expect(labels.get('a')).toBe('X · 10/14');
    expect(labels.get('b')).toBe('X');
  });
});
