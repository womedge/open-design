// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProjectName } from '../../../src/components/usage/ProjectName';
import { I18nProvider } from '../../../src/i18n';

afterEach(cleanup);

const renderName = (label: Parameters<typeof ProjectName>[0]['label']) =>
  render(
    <I18nProvider initial="zh-TW">
      <ProjectName label={label} />
    </I18nProvider>,
  );

describe('ProjectName', () => {
  it('renders a live project as plain text', () => {
    const { container } = renderName({ text: 'Live', deleted: false, nameless: false });
    expect(container.textContent).toBe('Live');
    expect(screen.queryByTestId('usage-project-struck')).toBeNull();
  });

  it('strikes a deleted project through and adds a spoken hint', () => {
    const { container } = renderName({ text: 'Old', deleted: true, nameless: false });
    const struck = screen.getByTestId('usage-project-struck');
    expect(struck.textContent).toBe('Old');
    expect(struck.className).toMatch(/struck/);
    expect(container.textContent).toBe('Old（已刪除）');
  });

  it('does not strike a nameless deleted project (the text already says so)', () => {
    const { container } = renderName({ text: '已刪除專案', deleted: true, nameless: true });
    expect(screen.queryByTestId('usage-project-struck')).toBeNull();
    expect(container.textContent).toBe('已刪除專案');
  });
});
