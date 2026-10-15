// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { UsageSummaryResponse } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UsageView } from '../../../src/components/usage/UsageView';
import { I18nProvider } from '../../../src/i18n';

const zeroTokens = { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 };

function summary(over: Partial<UsageSummaryResponse> = {}): UsageSummaryResponse {
  return {
    query: { from: '2026-10-01', to: '2026-10-03' },
    totals: { costUsd: 50.86, tokens: 1_230_000_000, runs: 65 },
    compareTotals: { costUsd: 41.35, tokens: 98_000_000, runs: 54 },
    projects: [
      { projectId: 'p1', projectName: 'Brand site', costUsd: 30, runs: 40 },
      { projectId: 'p2', projectName: null, deleted: true, costUsd: 20.86, runs: 25 },
    ],
    people: [
      {
        user: 'ann@example.com', costUsd: 40, tokens: 100_000_000, runs: 50,
        projects: [{ key: 'p1', costUsd: 30, tokens: 1 }, { key: 'p2', costUsd: 10, tokens: 1 }],
        models: [{ key: 'claude-opus-5-5', costUsd: 40, tokens: 1 }],
        daily: [{ date: '2026-10-01', costUsd: 40 }],
      },
      {
        user: 'automatic', costUsd: 10.86, tokens: 23_000_000, runs: 15,
        projects: [], models: [], daily: [],
      },
    ],
    daily: [
      { date: '2026-10-01', costUsd: 20, byModel: { 'claude-opus-5-5': 20 } },
      { date: '2026-10-02', costUsd: 0, byModel: {} },
      { date: '2026-10-03', costUsd: 30.86, byModel: { 'claude-opus-5-5': 20, 'gpt-5.5': 10.86 } },
    ],
    compareDaily: [
      { date: '2026-09-01', costUsd: 10 },
      { date: '2026-09-02', costUsd: 15 },
      { date: '2026-09-03', costUsd: 16.35 },
    ],
    models: [
      { model: 'claude-opus-5-5', agentIds: ['claude'], runs: 50, tokens: { ...zeroTokens, input: 10_000_000 }, costUsd: 40 },
      { model: 'gpt-5.5', agentIds: ['codex'], runs: 15, tokens: { ...zeroTokens, output: 5_000_000 }, costUsd: 10.86 },
    ],
    modelTokenTotals: { ...zeroTokens, input: 10_000_000, output: 5_000_000 },
    prices: [
      { model: 'claude-opus-5-5', input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20, effectiveFrom: '2026-10-01' },
    ],
    unpricedModels: [],
    recordedSince: '2026-09-01',
    ...over,
  };
}

function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
  vi.stubGlobal('fetch', spy);
  return spy;
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

function renderView() {
  return render(
    <I18nProvider initial="zh-TW">
      <UsageView />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UsageView', () => {
  it('shows KPIs, deltas against the comparison period and the single footnote', async () => {
    mockFetch(() => json(summary()));
    renderView();

    const cost = await screen.findByTestId('usage-kpi-cost');
    expect(within(cost).getByText('US$50.86')).toBeTruthy();
    const costDelta = screen.getByTestId('usage-kpi-cost-delta');
    expect(costDelta.textContent).toContain('+23%');
    expect(costDelta.textContent).toContain('比上月');

    const tokens = screen.getByTestId('usage-kpi-tokens');
    expect(within(tokens).getByText('12.3 億')).toBeTruthy();
    expect(within(tokens).getByText('token')).toBeTruthy();
    expect(screen.getByTestId('usage-kpi-runs').textContent).toContain('65');
    expect(screen.getAllByText('※ 金額依官方 API 價格估算')).toHaveLength(1);
  });

  it('hides every delta when compareTotals is null', async () => {
    mockFetch(() => json(summary({ compareTotals: null, compareDaily: null })));
    renderView();
    await screen.findByTestId('usage-kpi-cost');
    expect(screen.queryByTestId('usage-kpi-cost-delta')).toBeNull();
    expect(screen.queryByTestId('usage-kpi-runs-delta')).toBeNull();
    expect(screen.queryByTestId('usage-chart-compare')).toBeNull();
  });

  it('draws the comparison line only with a comparison period', async () => {
    mockFetch(() => json(summary()));
    renderView();
    await screen.findByTestId('usage-kpi-cost');
    expect(screen.getByTestId('usage-chart-compare')).toBeTruthy();
    expect(screen.getAllByTestId('usage-chart-col')).toHaveLength(3);
  });

  it('lists projects with share and names deleted ones', async () => {
    mockFetch(() => json(summary()));
    renderView();
    const rows = await screen.findAllByTestId('usage-project-row');
    expect(rows[0]!.textContent).toContain('Brand site');
    expect(rows[0]!.textContent).toContain('59.0%');
    expect(rows[1]!.textContent).toContain('已刪除專案');
  });

  it('expands a person to show their breakdown, with 自動執行 for unattended runs', async () => {
    mockFetch(() => json(summary()));
    renderView();
    const people = await screen.findAllByTestId('usage-person');
    expect(people[1]!.textContent).toContain('自動執行');
    fireEvent.click(within(people[0]!).getByRole('button'));
    expect(within(people[0]!).getByText('Claude Opus 5.5')).toBeTruthy();
    expect(within(people[0]!).getAllByText('Brand site').length).toBeGreaterThan(0);
  });

  it('keeps 明細 collapsed until opened', async () => {
    mockFetch(() => json(summary()));
    renderView();
    const toggle = await screen.findByRole('button', { name: '明細' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('每 100 萬 token，USD')).toBeTruthy();
    expect(screen.getByText('自 2026-10-01 起')).toBeTruthy();
  });

  it('shows the empty state when the period has no usage', async () => {
    mockFetch(() =>
      json(summary({
        totals: { costUsd: 0, tokens: 0, runs: 0 }, compareTotals: null, compareDaily: null,
        projects: [], people: [], models: [], daily: [], prices: [],
      })),
    );
    renderView();
    expect(await screen.findByTestId('usage-empty')).toBeTruthy();
    expect(screen.queryByTestId('usage-kpi-cost')).toBeNull();
  });

  it('requests the default window, then narrows by filter', async () => {
    const spy = mockFetch(() => json(summary()));
    renderView();
    await screen.findByTestId('usage-kpi-cost');
    const first = new URL(String(spy.mock.calls.find((c) => String(c[0]).startsWith('/api/usage'))![0]), 'http://x');
    expect(first.pathname).toBe('/api/usage/summary');
    expect(first.searchParams.get('compareFrom')).not.toBeNull();
    expect(first.searchParams.get('projectId')).toBeNull();

    fireEvent.change(screen.getByTestId('usage-filter-project'), { target: { value: 'p1' } });
    await waitFor(() => {
      const last = new URL(String(spy.mock.calls.at(-1)![0]), 'http://x');
      expect(last.searchParams.get('projectId')).toBe('p1');
    });
  });

  it('reports a failed export and retries it', async () => {
    const createUrl = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    let exportCalls = 0;
    const spy = mockFetch((url) => {
      if (url.startsWith('/api/usage/export')) {
        exportCalls += 1;
        return exportCalls === 1 ? new Response('', { status: 500 }) : new Response('a,b', { status: 200 });
      }
      return json(summary());
    });
    renderView();
    await screen.findByTestId('usage-kpi-cost');

    fireEvent.click(screen.getByTestId('usage-export'));
    const alert = await screen.findByTestId('usage-export-error');
    expect(alert.textContent).toContain('匯出失敗');

    fireEvent.click(within(alert).getByRole('button', { name: '重試' }));
    await waitFor(() => expect(screen.queryByTestId('usage-export-error')).toBeNull());
    const exportUrl = new URL(String(spy.mock.calls.find((c) => String(c[0]).startsWith('/api/usage/export'))![0]), 'http://x');
    expect(exportUrl.searchParams.get('compareFrom')).toBeNull();
    expect(createUrl).toHaveBeenCalled();
  });

  it('applies a preset picked in the date dialog', async () => {
    const spy = mockFetch(() => json(summary()));
    renderView();
    await screen.findByTestId('usage-kpi-cost');
    fireEvent.click(screen.getByTestId('usage-date-trigger'));
    const dialog = await screen.findByTestId('usage-date-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '昨天' }));
    fireEvent.click(screen.getByTestId('usage-date-apply'));
    await waitFor(() => {
      const last = new URL(String(spy.mock.calls.at(-1)![0]), 'http://x');
      expect(last.searchParams.get('from')).toBe(last.searchParams.get('to'));
    });
    expect(screen.queryByTestId('usage-date-dialog')).toBeNull();
  });

  it('names unassigned runs 未指定專案 and offers them as a filter', async () => {
    const base = summary();
    mockFetch(() =>
      json(summary({
        projects: [{ projectId: '__none__', projectName: null, costUsd: 5, runs: 2 }, ...base.projects],
      })),
    );
    renderView();
    const rows = await screen.findAllByTestId('usage-project-row');
    expect(rows[0]!.textContent).toContain('未指定專案');
    expect(rows[0]!.textContent).not.toContain('已刪除專案');
    const select = screen.getByTestId('usage-filter-project') as HTMLSelectElement;
    expect([...select.options].some((o) => o.value === '__none__' && o.textContent === '未指定專案')).toBe(true);
  });

  it('lists models that have no price next to the cost', async () => {
    mockFetch(() => json(summary({ unpricedModels: ['gpt-5.2', 'unknown'] })));
    renderView();
    const note = await screen.findByTestId('usage-unpriced');
    expect(note.textContent).toBe('未計價：gpt-5.2、unknown');
  });

  it('does not show the previous period when a refetch fails', async () => {
    let calls = 0;
    mockFetch((url) => {
      if (!url.startsWith('/api/usage')) return json({ projects: [] });
      return ++calls === 1 ? json(summary()) : new Response('', { status: 500 });
    });
    renderView();
    await screen.findByTestId('usage-kpi-cost');
    fireEvent.change(screen.getByTestId('usage-filter-project'), { target: { value: 'p1' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('無法載入用量');
    expect(screen.queryByTestId('usage-kpi-cost')).toBeNull();
    expect(within(alert).getByRole('button', { name: '重試' })).toBeTruthy();
  });

  it('makes collapsed 明細 content inert', async () => {
    mockFetch(() => json(summary()));
    renderView();
    const toggle = await screen.findByRole('button', { name: '明細' });
    const body = document.getElementById('usage-detail-body')!;
    expect(body.hasAttribute('inert')).toBe(true);
    fireEvent.click(toggle);
    expect(body.hasAttribute('inert')).toBe(false);
  });

  it('tells apart same-named projects by creation date, in rows, filter and drill-down', async () => {
    const base = summary();
    mockFetch((url) => {
      if (url === '/api/projects') {
        return json({
          projects: [
            { id: 'p1', name: 'Website Clone', createdAt: Date.parse('2026-10-13T16:30:00Z') },
            { id: 'p2', name: 'Website Clone', createdAt: Date.parse('2026-10-20T01:00:00Z') },
          ],
        });
      }
      return json(summary({
        projects: [
          { projectId: 'p1', projectName: 'Website Clone', costUsd: 30, runs: 40 },
          { projectId: 'p2', projectName: 'Website Clone', costUsd: 20, runs: 25 },
          { projectId: 'p3', projectName: null, deleted: true, costUsd: 0.86, runs: 1 },
        ],
        people: base.people,
      }));
    });
    renderView();
    const rows = await screen.findAllByTestId('usage-project-row');
    await waitFor(() => expect(rows.map((r) => r.textContent).join()).toContain('Website Clone · 10/14'));
    expect(rows[1]!.textContent).toContain('Website Clone · 10/20');
    expect(rows[2]!.textContent).toContain('已刪除專案');
    const select = screen.getByTestId('usage-filter-project') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toContain('Website Clone · 10/20');
    const people = screen.getAllByTestId('usage-person');
    fireEvent.click(within(people[0]!).getByRole('button'));
    expect(within(people[0]!).getByText('Website Clone · 10/14')).toBeTruthy();
  });

  it('shows the top 8 projects, then lists all of them in a scroll area and collapses back', async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      projectId: `p${i}`, projectName: `Project ${i}`, costUsd: 11 - i, runs: 1,
    }));
    mockFetch((url) => (url.startsWith('/api/usage') ? json(summary({ projects: many })) : json({ projects: [] })));
    renderView();
    const toggle = await screen.findByTestId('usage-projects-toggle');
    expect(toggle.textContent).toBe('顯示全部 11 個');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByTestId('usage-project-row')).toHaveLength(8);
    const list = screen.getByTestId('usage-projects-list');
    expect(list.getAttribute('tabindex')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe('收起');
    expect(screen.getAllByTestId('usage-project-row')).toHaveLength(11);
    // The expanded list is a focusable, labelled scroll region; the card keeps its height.
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(list.getAttribute('role')).toBe('region');
    expect(list.getAttribute('aria-label')).toBe('各專案用量');
    expect(list.className).toMatch(/projectRowsScroll/);
    expect(list.closest('section')!.getAttribute('style') ?? '').toMatch(/height/);

    list.scrollTop = 120;
    fireEvent.click(toggle);
    expect(list.scrollTop).toBe(0);
    expect(toggle.textContent).toBe('顯示全部 11 個');
    expect(screen.getAllByTestId('usage-project-row')).toHaveLength(8);
    expect(list.closest('section')!.getAttribute('style') ?? '').not.toMatch(/height/);
  });

  it('has no expand button for 8 projects or fewer', async () => {
    mockFetch(() => json(summary()));
    renderView();
    await screen.findByTestId('usage-kpi-cost');
    expect(screen.queryByTestId('usage-projects-toggle')).toBeNull();
  });

  it('draws deleted projects struck through in rows, filter options and drill-down', async () => {
    const base = summary();
    mockFetch((url) => {
      if (!url.startsWith('/api/usage')) return json({ projects: [] });
      return json(summary({
        projects: [
          { projectId: 'p1', projectName: 'Live Site', deleted: false, costUsd: 30, runs: 40 },
          { projectId: 'p2', projectName: 'Old Site', deleted: true, costUsd: 20, runs: 25 },
        ],
        people: [{
          ...base.people[0]!,
          projects: [
            { key: 'p1', name: 'Live Site', deleted: false, costUsd: 30, tokens: 1 },
            { key: 'p2', name: 'Old Site', deleted: true, costUsd: 10, tokens: 1 },
          ],
        }],
      }));
    });
    renderView();
    const rows = await screen.findAllByTestId('usage-project-row');

    // 各專案用量: name kept, struck, with a hidden spoken hint; live row untouched.
    const struck = within(rows[1]!).getByTestId('usage-project-struck');
    expect(struck.textContent).toBe('Old Site');
    expect(getComputedStyle(struck).textDecorationLine === 'line-through' || struck.className.includes('struck')).toBe(true);
    expect(rows[1]!.textContent).toContain('（已刪除）');
    expect(within(rows[0]!).queryByTestId('usage-project-struck')).toBeNull();
    expect(rows[0]!.textContent).not.toContain('已刪除');

    // 專案 filter: plain text only.
    const select = screen.getByTestId('usage-filter-project') as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toContain('Old Site（已刪除）');
    expect(labels).toContain('Live Site');

    // Drill-down.
    const person = screen.getAllByTestId('usage-person')[0]!;
    fireEvent.click(within(person).getByRole('button'));
    expect(within(person).getByTestId('usage-project-struck').textContent).toBe('Old Site');
  });
});
