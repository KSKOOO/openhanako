/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';

const mocks = vi.hoisted(() => ({
  loadDeskFiles: vi.fn(async () => {}),
}));

vi.mock('../../stores/desk-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/desk-actions')>();
  return {
    ...actual,
    loadDeskFiles: mocks.loadDeskFiles,
  };
});

describe('DeskSection directory watching', () => {
  let emitFileChanged: ((filePath: string) => void) | null;
  let watchFile: ReturnType<typeof vi.fn>;
  let unwatchFile: ReturnType<typeof vi.fn>;
  let localStorageData: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorageData = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => localStorageData[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageData[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageData[key];
      }),
      clear: vi.fn(() => {
        localStorageData = {};
      }),
    });
    emitFileChanged = null;
    watchFile = vi.fn(async () => true);
    unwatchFile = vi.fn(async () => true);
    window.t = ((key: string) => key === 'desk.workspaceTitle' ? '工作空间' : key) as typeof window.t;
    window.platform = {
      watchFile,
      unwatchFile,
      onFileChanged: vi.fn((callback: (filePath: string) => void) => {
        emitFileChanged = callback;
      }),
    } as unknown as typeof window.platform;
    useStore.setState({
      serverPort: 62950,
      deskBasePath: '/tmp/hana-desk',
      deskCurrentPath: 'notes',
      deskFiles: [],
      deskJianContent: null,
      currentTab: 'chat',
      jianOpen: true,
      jianView: 'desk',
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('watches the visible desk directory and reloads when that directory changes', async () => {
    const { DeskSection } = await import('../../components/DeskSection');

    render(<DeskSection />);

    expect(watchFile).toHaveBeenCalledWith('/tmp/hana-desk/notes');

    act(() => {
      emitFileChanged?.('/tmp/hana-desk/notes');
      vi.runOnlyPendingTimers();
    });

    expect(mocks.loadDeskFiles).toHaveBeenCalledWith();
  });

  it('uses the visible workspace root name as the sidebar title', async () => {
    const { DeskSection } = await import('../../components/DeskSection');

    render(<DeskSection />);

    expect(screen.getByText('工作空间 · hana-desk')).toBeTruthy();

    act(() => {
      useStore.setState({ deskBasePath: '/workspace/Desktop', deskCurrentPath: '' } as never);
    });

    expect(screen.getByText('工作空间 · Desktop')).toBeTruthy();
  });

  it('unwatches the previous directory after navigating to another desk folder', async () => {
    const { DeskSection } = await import('../../components/DeskSection');

    render(<DeskSection />);
    expect(watchFile).toHaveBeenCalledWith('/tmp/hana-desk/notes');

    act(() => {
      useStore.setState({ deskCurrentPath: 'archive' } as never);
    });

    expect(unwatchFile).toHaveBeenCalledWith('/tmp/hana-desk/notes');
    expect(watchFile).toHaveBeenCalledWith('/tmp/hana-desk/archive');

    mocks.loadDeskFiles.mockClear();
    act(() => {
      emitFileChanged?.('/tmp/hana-desk/notes');
      vi.runOnlyPendingTimers();
    });

    expect(mocks.loadDeskFiles).not.toHaveBeenCalled();
  });
});
