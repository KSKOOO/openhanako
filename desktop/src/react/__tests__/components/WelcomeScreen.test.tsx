/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';

const translations: Record<string, string | string[] | Record<string, { avatar: string }>> = {
  'input.workspace': '工作空间：',
  'input.currentWorkspace': '本次工作空间',
  'input.selectOtherFolder': '选择其他文件夹',
  'input.extraFolders': '额外文件夹',
  'input.addExternalFolder': '添加工作空间以外的文件夹',
  'welcome.messages': ['想到什么就说什么吧~'],
  'yuan.welcome.hanako': ['想到什么就说什么吧~'],
  'yuan.types': { hanako: { avatar: 'Hanako.png' } },
};

describe('WelcomeScreen workspace picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const t = vi.fn((key: string) => translations[key] ?? key);
    vi.stubGlobal('t', t);
    window.t = t as typeof window.t;
    window.platform = { selectFolder: vi.fn() } as unknown as typeof window.platform;
    useStore.setState({
      welcomeVisible: true,
      agents: [],
      agentName: 'Hanako',
      agentAvatarUrl: null,
      agentYuan: 'hanako',
      currentAgentId: null,
      selectedAgentId: null,
      memoryEnabled: true,
      selectedFolder: '/workspace/Desktop',
      homeFolder: '/workspace/Desktop/project-hana',
      cwdHistory: ['/workspace/Desktop/project-hana'],
      workspaceFolders: ['/workspace/Reference'],
      locale: 'zh',
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('groups primary workspace selection before extra folders', async () => {
    const { WelcomeScreen } = await import('../../components/WelcomeScreen');

    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /工作空间：Desktop/ }));

    const currentLabel = screen.getByText('本次工作空间');
    const selectOther = screen.getByText('选择其他文件夹');
    const extraLabel = screen.getByText('额外文件夹');
    const addExternal = screen.getByText('添加工作空间以外的文件夹');

    expect(currentLabel.compareDocumentPosition(selectOther) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(selectOther.compareDocumentPosition(extraLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(extraLabel.compareDocumentPosition(addExternal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
