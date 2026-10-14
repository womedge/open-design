// @vitest-environment jsdom
// Self-hosted builds set NEXT_PUBLIC_OD_HIDE_CLOUD_PROMO=1. On the run-error
// card that means: no "switch to OpenDesign Cloud" button, and "contact us"
// opens a mail to the internal admin instead of the official support dialog.
// Default builds keep both unchanged.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { forwardRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ hide: false }));
vi.mock('../../src/utils/cloudPromo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/cloudPromo')>();
  return {
    ...actual,
    get HIDE_CLOUD_PROMO() {
      return flags.hide;
    },
  };
});

import { ChatPane } from '../../src/components/ChatPane';
import { ADMIN_CONTACT_EMAIL, adminContactMailto } from '../../src/utils/cloudPromo';
import { zhCN } from '../../src/i18n/locales/zh-CN';
import type { AppConfig, ChatMessage } from '../../src/types';

const translate = (key: string) => zhCN[key as keyof typeof zhCN] ?? key;
vi.mock('../../src/i18n', () => ({
  useI18n: () => ({ locale: 'zh-CN', setLocale: () => undefined, t: translate }),
  useT: () => translate,
}));
vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef((_props, _ref) => <div data-testid="composer" />),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  flags.hide = false;
});

const failed: ChatMessage = {
  id: 'failed-assistant',
  role: 'assistant',
  content: '',
  createdAt: 1000,
  endedAt: 2000,
  runId: 'failed-run',
  runStatus: 'failed',
  agentId: 'claude',
  events: [{
    kind: 'status',
    label: 'error',
    code: 'AGENT_EXECUTION_FAILED',
    detail: 'x',
    failureDetail: 'process_crashed',
  }],
};

function renderPane() {
  render(
    <ChatPane
      messages={[{ id: 'user-1', role: 'user', content: 'hi', createdAt: 0 }, failed]}
      streaming={false}
      error={null}
      projectId="p"
      projectFiles={[]}
      onEnsureProject={async () => 'p'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      conversations={[{ projectId: 'p', id: 'c', title: 'Current', createdAt: 0, updatedAt: 0 }]}
      activeConversationId="c"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
      config={{ mode: 'daemon', agentId: 'claude', agentCliEnv: {} } as AppConfig}
      onRetry={vi.fn()}
      onSwitchToAmrAndRetry={vi.fn()}
    />,
  );
}

describe('run-error card under HIDE_CLOUD_PROMO', () => {
  it('builds a subject-prefilled mailto for the admin', () => {
    expect(adminContactMailto()).toBe(
      `mailto:${ADMIN_CONTACT_EMAIL}?subject=${encodeURIComponent('AWP+ 任務失敗')}`,
    );
    expect(ADMIN_CONTACT_EMAIL).toBe('sam@womedge.com');
  });

  it('hides switch-to-cloud and mails the admin instead of opening support channels', () => {
    flags.hide = true;
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPane();
    const card = screen.getByTestId('chat-run-error-card');
    expect(within(card).queryByTestId('chat-error-switch-to-cloud')).toBeNull();
    expect(within(card).queryByText('切换到 OpenDesign Cloud')).toBeNull();
    expect(within(card).queryByText('导出日志')).toBeNull();
    expect(within(card).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(within(card).getByTestId('chat-error-contact-support'));
    expect(open).toHaveBeenCalledWith(adminContactMailto(), '_self');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps stock behavior by default', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPane();
    const card = screen.getByTestId('chat-run-error-card');
    expect(within(card).getByTestId('chat-error-switch-to-cloud')).toBeTruthy();
    expect(within(card).getByText('导出日志')).toBeTruthy();
    fireEvent.click(within(card).getByTestId('chat-error-contact-support'));
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
