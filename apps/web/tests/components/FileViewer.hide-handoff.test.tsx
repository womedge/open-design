// @vitest-environment jsdom

// Server deployments build with NEXT_PUBLIC_OD_HIDE_CLOUD_PROMO=1. The
// "open in editor / file manager" handoff acts on the daemon host, which is
// useless there, so the FileViewer must not render HandoffButton (and must not
// fetch /api/editors on its behalf). Default builds keep the button.

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import type { ProjectFile } from '../../src/types';

const flags = vi.hoisted(() => ({ hide: false }));
vi.mock('../../src/utils/cloudPromo', () => ({
  get HIDE_CLOUD_PROMO() {
    return flags.hide;
  },
}));

import { FileViewer } from '../../src/components/FileViewer';

function htmlFile(): ProjectFile {
  return {
    name: 'index.html',
    path: 'index.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Page',
      entry: 'index.html',
      renderer: 'html',
      exports: ['html'],
    },
  };
}

function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/editors')) {
      return new Response(JSON.stringify({ editors: [], platform: 'darwin' }), { status: 200 });
    }
    return new Response(JSON.stringify({ deployments: [] }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderViewer() {
  const props: ComponentProps<typeof FileViewer> = {
    projectId: 'project-1',
    projectKind: 'prototype',
    file: htmlFile(),
    liveHtml: '<html><body><h1>Hello</h1></body></html>',
  };
  return render(<FileViewer {...props} />);
}

function editorsRequested(fetchMock: ReturnType<typeof vi.fn>): boolean {
  return fetchMock.mock.calls.some(([input]) => String(input).includes('/api/editors'));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  flags.hide = false;
});

describe('FileViewer host-editor handoff vs HIDE_CLOUD_PROMO', () => {
  it('does not render the handoff button or fetch editors when the switch is on', async () => {
    flags.hide = true;
    const fetchMock = stubFetch();
    const { container } = renderViewer();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(container.querySelector('.handoff-wrap, .handoff-split')).toBeNull();
    expect(editorsRequested(fetchMock)).toBe(false);
  });

  it('keeps the handoff button by default', async () => {
    const fetchMock = stubFetch();
    const { container } = renderViewer();
    await waitFor(() => expect(container.querySelector('.handoff-wrap, .handoff-split')).not.toBeNull());
    await waitFor(() => expect(editorsRequested(fetchMock)).toBe(true));
  });
});
