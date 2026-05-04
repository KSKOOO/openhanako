/**
 * artifact-slice + artifact-actions 行为测试
 *
 * Artifact 内容池是 user-level flat state；可见 preview/tabs 由 workspace 激活流程恢复。
 * 覆盖：tab 操作、upsert / clear、openPreview / closePreview、handleArtifact。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createArtifactSlice,
  selectArtifacts,
  selectOpenTabs,
  selectActiveTabId,
  selectPinnedViewers,
  selectMarkdownPreviewIds,
} from '../../stores/artifact-slice';
import {
  upsertArtifact,
  openTab,
  closeTab,
  setActiveTab,
  clearPreview,
  openPreview,
  closePreview,
  handleArtifact,
  canSpawnViewer,
  setMarkdownPreviewActive,
  toggleMarkdownPreview,
} from '../../stores/artifact-actions';
import type { Artifact } from '../../types';

function createTestStore() {
  let state: Record<string, unknown> = {};

  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: Record<string, unknown>) => Record<string, unknown>)(state)
      : partial;
    state = { ...state, ...(patch as Record<string, unknown>) };
  };

  const artifactSlice = createArtifactSlice(set as any);
  state = {
    ...artifactSlice,
    currentSessionPath: null,
    previewOpen: false,
    setPreviewOpen: (open: boolean) => set({ previewOpen: open }),
    quotedSelection: null,
    clearQuotedSelection: () => set({ quotedSelection: null }),
  };

  return {
    getState: () => state as any,
    setState: set as any,
  };
}

let testStore: ReturnType<typeof createTestStore>;

vi.mock('../../stores/index', () => ({
  get useStore() {
    return Object.assign(
      (selector?: (s: any) => any) => selector ? selector(testStore.getState()) : testStore.getState(),
      {
        getState: () => testStore.getState(),
        setState: (partial: unknown) => testStore.setState(partial),
      },
    );
  },
}));

vi.mock('../../components/SidebarLayout', () => ({
  updateLayout: () => {},
}));

function makeArtifact(id: string, title?: string): Artifact {
  return { id, type: 'code', title: title ?? id, content: `content-${id}` };
}

describe('artifact slice (user-level content pool)', () => {
  beforeEach(() => {
    testStore = createTestStore();
  });

  describe('tab 操作', () => {
    it('openTab 新增 tab 并激活', () => {
      openTab('a1');
      expect(testStore.getState().openTabs).toEqual(['a1']);
      expect(testStore.getState().activeTabId).toBe('a1');
    });

    it('openTab 已存在的 id 只切换激活，不重复添加', () => {
      openTab('a1');
      openTab('a2');
      openTab('a1');
      expect(testStore.getState().openTabs).toEqual(['a1', 'a2']);
      expect(testStore.getState().activeTabId).toBe('a1');
    });

    it('closeTab 移除 tab，激活前一个', () => {
      openTab('a1');
      openTab('a2');
      openTab('a3');
      setActiveTab('a2');
      closeTab('a2');
      expect(testStore.getState().openTabs).toEqual(['a1', 'a3']);
      expect(testStore.getState().activeTabId).toBe('a1');
    });

    it('closeTab 关闭非 active tab，active 不变', () => {
      openTab('a1');
      openTab('a2');
      openTab('a3');
      setActiveTab('a2');
      closeTab('a3');
      expect(testStore.getState().openTabs).toEqual(['a1', 'a2']);
      expect(testStore.getState().activeTabId).toBe('a2');
    });

    it('closeTab 移除最后一个 tab，activeTabId 为 null', () => {
      openTab('a1');
      closeTab('a1');
      expect(testStore.getState().openTabs).toEqual([]);
      expect(testStore.getState().activeTabId).toBeNull();
    });

    it('closeTab 同步清理该 tab 的 Markdown 预览状态', () => {
      openTab('a1');
      setMarkdownPreviewActive('a1', true);
      closeTab('a1');
      expect(selectMarkdownPreviewIds(testStore.getState())).toEqual([]);
    });

    it('setActiveTab 切换激活', () => {
      openTab('a1');
      openTab('a2');
      setActiveTab('a1');
      expect(testStore.getState().activeTabId).toBe('a1');
    });
  });

  describe('upsertArtifact + selector', () => {
    it('新 id 追加', () => {
      const a = makeArtifact('a1');
      upsertArtifact(a);
      expect(selectArtifacts(testStore.getState())).toEqual([a]);
    });

    it('已存在 id 就地替换', () => {
      const a1 = makeArtifact('a1', 'v1');
      upsertArtifact(a1);
      const a1v2 = makeArtifact('a1', 'v2');
      upsertArtifact(a1v2);
      expect(selectArtifacts(testStore.getState())).toEqual([a1v2]);
    });

    it('selectors 直接读 flat state', () => {
      upsertArtifact(makeArtifact('a1'));
      openTab('a1');
      expect(selectOpenTabs(testStore.getState())).toEqual(['a1']);
      expect(selectActiveTabId(testStore.getState())).toBe('a1');
    });
  });

  describe('内容池不从 currentSessionPath 推导归属', () => {
    it('切换 currentSessionPath 不影响预览面板状态', () => {
      openTab('file-1');
      upsertArtifact(makeArtifact('file-1'));

      testStore.setState({ currentSessionPath: '/session/a' });
      expect(selectOpenTabs(testStore.getState())).toEqual(['file-1']);

      testStore.setState({ currentSessionPath: '/session/b' });
      expect(selectOpenTabs(testStore.getState())).toEqual(['file-1']);

      testStore.setState({ currentSessionPath: null });
      expect(selectOpenTabs(testStore.getState())).toEqual(['file-1']);
    });

    it('任何 session 下生成的 artifact 都进同一个全局池', () => {
      testStore.setState({ currentSessionPath: '/session/a' });
      upsertArtifact(makeArtifact('from-a'));

      testStore.setState({ currentSessionPath: '/session/b' });
      upsertArtifact(makeArtifact('from-b'));

      testStore.setState({ currentSessionPath: null });
      const arts = selectArtifacts(testStore.getState());
      expect(arts.map(a => a.id).sort()).toEqual(['from-a', 'from-b']);
    });
  });

  describe('clearPreview', () => {
    it('清空全部 artifacts / openTabs / activeTabId', () => {
      upsertArtifact(makeArtifact('a1'));
      upsertArtifact(makeArtifact('a2'));
      openTab('a1');
      openTab('a2');
      clearPreview();
      expect(selectArtifacts(testStore.getState())).toEqual([]);
      expect(selectOpenTabs(testStore.getState())).toEqual([]);
      expect(selectActiveTabId(testStore.getState())).toBeNull();
      expect(selectMarkdownPreviewIds(testStore.getState())).toEqual([]);
    });
  });

  describe('markdown preview eye state', () => {
    it('按 artifact id 记录临时阅读预览状态', () => {
      setMarkdownPreviewActive('file-a', true);
      expect(selectMarkdownPreviewIds(testStore.getState())).toEqual(['file-a']);

      setMarkdownPreviewActive('file-b', true);
      expect(selectMarkdownPreviewIds(testStore.getState()).sort()).toEqual(['file-a', 'file-b']);

      setMarkdownPreviewActive('file-a', false);
      expect(selectMarkdownPreviewIds(testStore.getState())).toEqual(['file-b']);
    });

    it('toggleMarkdownPreview 翻转指定 artifact 的预览状态', () => {
      toggleMarkdownPreview('file-a');
      expect(selectMarkdownPreviewIds(testStore.getState())).toEqual(['file-a']);

      toggleMarkdownPreview('file-a');
      expect(selectMarkdownPreviewIds(testStore.getState())).toEqual([]);
    });
  });

  describe('openPreview / closePreview', () => {
    it('openPreview upsert artifact + openTab + setPreviewOpen(true)', () => {
      const a = makeArtifact('p1');
      openPreview(a);
      expect(selectArtifacts(testStore.getState())).toEqual([a]);
      expect(selectOpenTabs(testStore.getState())).toEqual(['p1']);
      expect(selectActiveTabId(testStore.getState())).toBe('p1');
      expect(testStore.getState().previewOpen).toBe(true);
    });

    it('closePreview 只收起面板，不清 openTabs / artifacts', () => {
      const a = makeArtifact('p1');
      openPreview(a);
      closePreview();
      expect(testStore.getState().previewOpen).toBe(false);
      expect(selectOpenTabs(testStore.getState())).toEqual(['p1']);
      expect(selectArtifacts(testStore.getState())).toEqual([a]);
    });
  });

  describe('handleArtifact', () => {
    it('无 sessionPath 也正常入池（user-level 化后）', () => {
      handleArtifact({
        artifactId: 'stream-1',
        artifactType: 'code',
        title: 'streaming',
        content: 'console.log(1)',
      });
      const arts = selectArtifacts(testStore.getState());
      expect(arts).toHaveLength(1);
      expect(arts[0].id).toBe('stream-1');
    });

    it('事件携带 sessionPath 时也忽略（不再按 owner 路由）', () => {
      handleArtifact({
        artifactId: 'stream-2',
        artifactType: 'code',
        title: 's',
        content: 'x',
        sessionPath: '/session/whatever',
      });
      const arts = selectArtifacts(testStore.getState());
      expect(arts).toHaveLength(1);
      expect(arts[0].id).toBe('stream-2');
    });
  });

  describe('pinnedViewers（派生只读 viewer 窗口）', () => {
    it('初始为空数组', () => {
      expect(selectPinnedViewers(testStore.getState())).toEqual([]);
    });

    it('addPinnedViewer 追加一条', () => {
      testStore.getState().addPinnedViewer({ windowId: 7, filePath: '/a/b.md', title: 'b' });
      expect(selectPinnedViewers(testStore.getState())).toEqual([
        { windowId: 7, filePath: '/a/b.md', title: 'b' },
      ]);
    });

    it('addPinnedViewer 同 windowId 防重（理论上 Electron 不复用，但兜底）', () => {
      testStore.getState().addPinnedViewer({ windowId: 7, filePath: '/a/b.md', title: 'b' });
      testStore.getState().addPinnedViewer({ windowId: 7, filePath: '/a/other.md', title: 'other' });
      expect(selectPinnedViewers(testStore.getState())).toHaveLength(1);
      expect(selectPinnedViewers(testStore.getState())[0].filePath).toBe('/a/b.md');
    });

    it('removePinnedViewer 按 windowId 精确删除', () => {
      testStore.getState().addPinnedViewer({ windowId: 1, filePath: '/a.md', title: 'a' });
      testStore.getState().addPinnedViewer({ windowId: 2, filePath: '/b.md', title: 'b' });
      testStore.getState().addPinnedViewer({ windowId: 3, filePath: '/c.md', title: 'c' });
      testStore.getState().removePinnedViewer(2);
      expect(selectPinnedViewers(testStore.getState()).map(v => v.windowId)).toEqual([1, 3]);
    });

    it('removePinnedViewer 不存在的 windowId 为 no-op', () => {
      testStore.getState().addPinnedViewer({ windowId: 1, filePath: '/a.md', title: 'a' });
      testStore.getState().removePinnedViewer(999);
      expect(selectPinnedViewers(testStore.getState())).toHaveLength(1);
    });

    it('clearPinnedViewers 清空全部', () => {
      testStore.getState().addPinnedViewer({ windowId: 1, filePath: '/a.md', title: 'a' });
      testStore.getState().addPinnedViewer({ windowId: 2, filePath: '/b.md', title: 'b' });
      testStore.getState().clearPinnedViewers();
      expect(selectPinnedViewers(testStore.getState())).toEqual([]);
    });
  });

  describe('canSpawnViewer', () => {
    it('markdown + filePath → true', () => {
      const a: Artifact = { id: '1', type: 'markdown', title: 't', content: 'c', filePath: '/x.md' };
      expect(canSpawnViewer(a)).toBe(true);
    });

    it('code + filePath → true', () => {
      const a: Artifact = { id: '1', type: 'code', title: 't', content: 'c', filePath: '/x.py' };
      expect(canSpawnViewer(a)).toBe(true);
    });

    it('csv + filePath → true', () => {
      const a: Artifact = { id: '1', type: 'csv', title: 't', content: 'c', filePath: '/x.csv' };
      expect(canSpawnViewer(a)).toBe(true);
    });

    it('memory markdown（无 filePath）→ false', () => {
      const a: Artifact = { id: '1', type: 'markdown', title: 't', content: 'c' };
      expect(canSpawnViewer(a)).toBe(false);
    });

    it('html 类型（有 filePath）→ false，暂不支持', () => {
      const a: Artifact = { id: '1', type: 'html', title: 't', content: 'c', filePath: '/x.html' };
      expect(canSpawnViewer(a)).toBe(false);
    });

    it('pdf → false', () => {
      const a: Artifact = { id: '1', type: 'pdf', title: 't', content: 'c', filePath: '/x.pdf' };
      expect(canSpawnViewer(a)).toBe(false);
    });

    it('null → false', () => {
      expect(canSpawnViewer(null)).toBe(false);
    });
  });
});
