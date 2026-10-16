// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceTabsBar } from '../../src/components/WorkspaceTabsBar';
import type { Route } from '../../src/router';
import type { Project } from '../../src/types';

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'en', setLocale: () => undefined, t: (key: string) => key }),
  useT: () => (key: string) => key,
}));

vi.mock('../../src/router', async () => {
  const actual = await vi.importActual<typeof import('../../src/router')>('../../src/router');
  return { ...actual, navigate: vi.fn() };
});

const STORE_KEY = 'open-design:workspace-tabs:v1';
const usageRoute: Route = { kind: 'home', view: 'usage' };
const routeOf = (projectId: string): Route => ({
  kind: 'project',
  projectId,
  conversationId: null,
  fileName: null,
});
const mk = (id: string): Project => ({
  id,
  name: 'Website Clone',
  skillId: null,
  designSystemId: null,
  createdAt: 1,
  updatedAt: 1,
});
const projects = [mk('w1'), mk('w2')];

/** The active tab as persisted — what the strip and the dropdown trigger render. */
function activeTab(): { kind: string; projectId?: string } | null {
  const raw = window.localStorage.getItem(STORE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as {
    tabs: Array<{ id: string; kind: string; projectId?: string }>;
    activeTabId: string;
  };
  return parsed.tabs.find((tab) => tab.id === parsed.activeTabId) ?? null;
}

/** Storage left behind by a session that last sat on 用量統計 with two project tabs open. */
function seedEntryActive(scopeKey: string | undefined) {
  const state = {
    tabs: [
      { id: 'entry:1', kind: 'entry', view: 'usage', createdAt: 1, lastActiveAt: 3 },
      { id: 'project:w1:1', kind: 'project', projectId: 'w1', conversationId: null, fileName: null, createdAt: 1, lastActiveAt: 2 },
      { id: 'project:w2:1', kind: 'project', projectId: 'w2', conversationId: null, fileName: null, createdAt: 1, lastActiveAt: 1 },
    ],
    activeTabId: 'entry:1',
  };
  window.localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      ...state,
      ...(scopeKey ? { scopeKey, scopes: { [scopeKey]: { state, updatedAt: 1 } } } : {}),
    }),
  );
}

describe('WorkspaceTabsBar keeps the active tab on the route', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it('activates an existing project tab when the route moves from 用量統計 to it', async () => {
    seedEntryActive('anon::none');
    const { rerender } = render(
      <WorkspaceTabsBar route={usageRoute} projects={projects} identityScopeKey="anon::none" />,
    );
    rerender(
      <WorkspaceTabsBar route={routeOf('w1')} projects={projects} identityScopeKey="anon::none" />,
    );
    await waitFor(() => expect(activeTab()).toMatchObject({ kind: 'project', projectId: 'w1' }));
  });

  it('mounting straight on a project route over an entry-active snapshot activates the project', async () => {
    seedEntryActive('anon::none');
    render(
      <WorkspaceTabsBar route={routeOf('w2')} projects={projects} identityScopeKey="anon::none" />,
    );
    await waitFor(() => expect(activeTab()).toMatchObject({ kind: 'project', projectId: 'w2' }));
  });

  it('mounting on a project route while the scope is unresolved, then resolving, activates the project', async () => {
    seedEntryActive('anon::none');
    const { rerender } = render(
      <WorkspaceTabsBar route={routeOf('w2')} projects={projects} identityScopeKey={null} />,
    );
    rerender(
      <WorkspaceTabsBar route={routeOf('w2')} projects={projects} identityScopeKey="anon::none" />,
    );
    await waitFor(() => expect(activeTab()).toMatchObject({ kind: 'project', projectId: 'w2' }));
  });

  it('route and scope key arriving in the same render still activates the project', async () => {
    seedEntryActive('anon::none');
    const { rerender } = render(
      <WorkspaceTabsBar route={usageRoute} projects={projects} identityScopeKey={null} />,
    );
    rerender(
      <WorkspaceTabsBar route={routeOf('w1')} projects={projects} identityScopeKey="anon::none" />,
    );
    await waitFor(() => expect(activeTab()).toMatchObject({ kind: 'project', projectId: 'w1' }));
  });

  it('a scope key that blips to null and back while on a project route keeps the project active', async () => {
    seedEntryActive('anon::none');
    const { rerender } = render(
      <WorkspaceTabsBar route={usageRoute} projects={projects} identityScopeKey="anon::none" />,
    );
    rerender(<WorkspaceTabsBar route={routeOf('w1')} projects={projects} identityScopeKey={null} />);
    rerender(
      <WorkspaceTabsBar route={routeOf('w1')} projects={projects} identityScopeKey="anon::none" />,
    );
    await waitFor(() => expect(activeTab()).toMatchObject({ kind: 'project', projectId: 'w1' }));
  });

  it('opening a project when the scope key is still unresolved activates it once it resolves', async () => {
    seedEntryActive('anon::none');
    const { rerender } = render(
      <WorkspaceTabsBar route={usageRoute} projects={projects} identityScopeKey={null} />,
    );
    rerender(<WorkspaceTabsBar route={routeOf('w1')} projects={projects} identityScopeKey={null} />);
    rerender(
      <WorkspaceTabsBar route={routeOf('w1')} projects={projects} identityScopeKey="anon::none" />,
    );
    await waitFor(() => expect(activeTab()).toMatchObject({ kind: 'project', projectId: 'w1' }));
  });

  it('returning to 用量統計 from a project activates the entry tab', async () => {
    seedEntryActive('anon::none');
    const { rerender } = render(
      <WorkspaceTabsBar route={routeOf('w1')} projects={projects} identityScopeKey="anon::none" />,
    );
    rerender(
      <WorkspaceTabsBar route={usageRoute} projects={projects} identityScopeKey="anon::none" />,
    );
    await waitFor(() => expect(activeTab()).toMatchObject({ kind: 'entry' }));
  });

  it('a scope-change bounce that the router never lands on does not freeze route syncing', async () => {
    // Opening a Workspace-bound project from 用量統計 changes the scope key, the
    // bar rebuilds that scope and navigates to its Home. If the router ends up
    // somewhere else (here: a project), the "wait for the expected path" guard
    // must not stay armed — otherwise every later route is dropped and the
    // entry tab stays active under a project page.
    seedEntryActive('anon::none');
    const { rerender } = render(
      <WorkspaceTabsBar route={usageRoute} projects={projects} identityScopeKey="anon::none" />,
    );
    rerender(
      <WorkspaceTabsBar
        route={routeOf('w1')}
        projects={projects}
        activeProjectWorkspaceId="ws-1"
        identityScopeKey="anon::ws-1"
      />,
    );
    rerender(
      <WorkspaceTabsBar
        route={routeOf('w2')}
        projects={projects}
        activeProjectWorkspaceId="ws-1"
        identityScopeKey="anon::ws-1"
      />,
    );
    await waitFor(() => expect(activeTab()).toMatchObject({ kind: 'project', projectId: 'w2' }));
  });
});
