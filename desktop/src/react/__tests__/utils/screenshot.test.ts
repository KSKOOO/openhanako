/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../stores', () => ({
  useStore: {
    getState: () => ({ homeFolder: '/tmp/hana-home' }),
  },
}));

import { takeArticleScreenshot } from '../../utils/screenshot';

describe('takeArticleScreenshot', () => {
  const notices: Array<{ text: string; type: string; deskDir?: string }> = [];
  const noticeHandler = (event: Event) => {
    notices.push((event as CustomEvent).detail);
  };

  beforeEach(() => {
    notices.length = 0;
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    window.addEventListener('hana-inline-notice', noticeHandler);
    (window as any).t = (key: string) => (
      key === 'common.screenshotFailed' ? '截图保存失败'
        : key === 'common.screenshotSaved' ? '截图已保存'
          : key
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.removeEventListener('hana-inline-notice', noticeHandler);
    delete (window as any).hana;
    delete (window as any).t;
  });

  it('主进程 IPC reject 时，给用户发出明确失败提示而不是变成未处理异常', async () => {
    (window as any).hana = {
      screenshotRender: vi.fn().mockRejectedValue(new Error('disk full')),
    };

    await expect(takeArticleScreenshot('# hello')).resolves.toBeUndefined();

    expect((window as any).hana.screenshotRender).toHaveBeenCalledOnce();
    expect(notices).toEqual([
      expect.objectContaining({
        type: 'error',
        text: expect.stringContaining('disk full'),
      }),
    ]);
  });
});
