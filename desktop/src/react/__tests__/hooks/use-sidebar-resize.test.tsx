/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useSidebarResize } from '../../hooks/use-sidebar-resize';

function Harness() {
  useSidebarResize();
  return null;
}

function installResizeDom() {
  document.body.innerHTML = `
    <div id="sidebar"><div class="sidebar-inner"></div></div>
    <div id="jianSidebar"><div class="jian-sidebar-inner"></div></div>
    <div id="previewPanel"><div class="preview-panel-inner"></div></div>
    <div id="sidebarResizeHandle"></div>
    <div id="jianResizeHandle"></div>
    <div id="previewResizeHandle"></div>
  `;

  const sidebar = document.getElementById('sidebar') as HTMLElement;
  const jianSidebar = document.getElementById('jianSidebar') as HTMLElement;
  const previewPanel = document.getElementById('previewPanel') as HTMLElement;
  Object.defineProperty(sidebar, 'offsetWidth', { configurable: true, value: 240 });
  Object.defineProperty(jianSidebar, 'offsetWidth', { configurable: true, value: 260 });
  Object.defineProperty(previewPanel, 'offsetWidth', { configurable: true, value: 580 });

  const storage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

describe('useSidebarResize', () => {
  beforeEach(() => {
    installResizeDom();
  });

  it('unmount 时会清理 handle 监听和进行中的拖拽监听', () => {
    const leftHandle = document.getElementById('sidebarResizeHandle') as HTMLElement;
    const removeHandleSpy = vi.spyOn(leftHandle, 'removeEventListener');
    const removeDocumentSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = render(<Harness />);
    fireEvent.mouseDown(leftHandle, { clientX: 200 });
    unmount();

    expect(removeHandleSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeHandleSpy).toHaveBeenCalledWith('mouseleave', expect.any(Function));
    expect(removeHandleSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
    expect(removeDocumentSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeDocumentSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });
});
