/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const loadStatus = vi.fn();
const saveBridgeConfig = vi.fn();
const testPlatform = vi.fn();
const setOwner = vi.fn();
const savePublicIshiki = vi.fn();
const setSelectedAgentId = vi.fn();
const showToast = vi.fn();

vi.mock('../../helpers', () => ({
  t: (key: string) => key,
}));

vi.mock('../../api', () => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../actions', () => ({
  loadSettingsConfig: vi.fn(),
}));

vi.mock('../../widgets/Toggle', () => ({
  Toggle: ({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) => (
    <button
      type="button"
      data-testid={`toggle-${on ? 'on' : 'off'}`}
      onClick={() => onChange(!on)}
    >
      toggle
    </button>
  ),
}));

vi.mock('../bridge/BridgeAgentRow', () => ({
  BridgeAgentRow: () => <div data-testid="bridge-agent-row">bridge-agent-row</div>,
}));

vi.mock('../bridge/PlatformSection', () => ({
  PlatformSection: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../bridge/WechatSection', () => ({
  WechatSection: () => <div>settings.bridge.wechat</div>,
}));

vi.mock('../bridge/useBridgeState', () => ({
  useBridgeState: () => ({
    status: {
      telegram: {},
      feishu: {},
      qq: {},
      wechat: {},
      readOnly: true,
      receiptEnabled: true,
      knownUsers: {},
      owner: {},
    },
    testingPlatform: null,
    showToast,
    loadStatus,
    selectedAgentId: 'agent-a',
    setSelectedAgentId,
    publicIshiki: '',
    setPublicIshiki: vi.fn(),
    savePublicIshiki,
    tgToken: '',
    setTgToken: vi.fn(),
    fsAppId: '',
    setFsAppId: vi.fn(),
    fsAppSecret: '',
    setFsAppSecret: vi.fn(),
    qqAppId: '',
    setQqAppId: vi.fn(),
    qqAppSecret: '',
    setQqAppSecret: vi.fn(),
    saveBridgeConfig,
    testPlatform,
    setOwner,
  }),
}));

import { BridgeTab } from '../BridgeTab';

afterEach(() => {
  cleanup();
});

describe('BridgeTab', () => {
  it('renders global settings above the agent section and keeps the agent row separate', () => {
    render(<BridgeTab />);

    const globalHeading = screen.getByRole('heading', { name: 'settings.bridge.globalSettings' });
    const agentHeading = screen.getByRole('heading', { name: 'settings.bridge.agentSettings' });
    const agentRow = screen.getByTestId('bridge-agent-row');

    expect(globalHeading.compareDocumentPosition(agentHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(agentHeading.compareDocumentPosition(agentRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('settings.bridge.receiptEnabled')).toBeTruthy();
    expect(screen.getByText('settings.bridge.readOnly')).toBeTruthy();
  });
});
