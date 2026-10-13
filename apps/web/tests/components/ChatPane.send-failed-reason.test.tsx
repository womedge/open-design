// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane } from '../../src/components/ChatPane';
import type { ChatMessage } from '../../src/types';

afterEach(() => cleanup());

function mount(message: ChatMessage) {
  render(
    <ChatPane
      messages={[message]}
      streaming={false}
      error={null}
      projectId="project-1"
      projectFiles={[]}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onResendUserMessage={vi.fn()}
      onStop={vi.fn()}
      conversations={[]}
      activeConversationId="conversation-1"
      onSelectConversation={vi.fn()}
      onDeleteConversation={vi.fn()}
    />,
  );
}

const base: ChatMessage = {
  id: 'user-send-failed-reason',
  role: 'user',
  content: 'Build the landing page',
  createdAt: 1,
  sendFailed: true,
};

describe('ChatPane send-failed reason note', () => {
  it('explains a run-in-progress conflict next to the retry button', () => {
    mount({ ...base, sendFailedReason: 'run_in_progress' });

    const note = screen.getByTestId('user-send-failed-note');
    expect(note.textContent).toBeTruthy();
    expect(screen.getByTestId('user-send-failed')).toBeTruthy();
    expect(note.parentElement).toBe(screen.getByTestId('user-send-failed').parentElement);
  });

  it('shows no note for a generic send failure', () => {
    mount(base);

    expect(screen.getByTestId('user-send-failed')).toBeTruthy();
    expect(screen.queryByTestId('user-send-failed-note')).toBeNull();
  });
});
