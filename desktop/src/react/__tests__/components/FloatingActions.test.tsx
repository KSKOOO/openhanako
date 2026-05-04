/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingActions } from '../../components/preview/FloatingActions';

describe('FloatingActions', () => {
  beforeEach(() => {
    window.t = ((key: string) => key) as typeof window.t;
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the markdown preview eye between copy and screenshot', () => {
    const toggle = vi.fn();
    render(
      <FloatingActions
        content="# note"
        showMarkdownPreviewToggle
        markdownPreviewActive={false}
        onToggleMarkdownPreview={toggle}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0].textContent).toContain('attach.copy');
    expect(buttons[1].getAttribute('aria-label')).toBe('preview.markdownPreview');
    expect(buttons[2].getAttribute('aria-label')).toBe('common.screenshot');

    fireEvent.click(buttons[1]);
    expect(toggle).toHaveBeenCalledTimes(1);
  });
});
