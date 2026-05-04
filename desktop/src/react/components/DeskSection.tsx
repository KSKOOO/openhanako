/**
 * DeskSection — 笺侧栏的工作空间内容区（编排层）
 *
 * 替代旧 desk.js 的 renderDeskFiles / initJianEditor / updateDeskEmptyOverlay 逻辑。
 * 由 App.tsx 在 .jian-chat-content 容器内直接渲染。
 *
 * 子组件拆分至 ./desk/ 目录。
 */

import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../stores';
import { loadDeskFiles } from '../stores/desk-actions';
import { subscribeFileChanges } from '../services/file-change-events';
import { ContextMenu } from './ContextMenu';
import { DESK_SORT_KEY, type SortMode, type CtxMenuState } from './desk/desk-types';
import { DeskOpenButton, DeskBreadcrumb, DeskRefreshButton, DeskSortButton } from './desk/DeskToolbar';
import { DeskFileList } from './desk/DeskFileList';
import { JianEditor } from './desk/DeskEditor';
import { DeskDropZone } from './desk/DeskDropZone';
import { DeskEmptyOverlay } from './desk/DeskEmptyOverlay';
import { DeskCwdSkillsButton, DeskCwdSkillsPanel } from './desk/DeskCwdSkills';
import s from './desk/Desk.module.css';
// @ts-expect-error — shared JS module
import { workspaceDisplayName } from '../../../../shared/workspace-history.js';

const DESK_RELOAD_DEBOUNCE_MS = 120;

function normalizeDirectoryPath(value: string): string {
  const slashed = value.replace(/\\/g, '/');
  if (/^[A-Za-z]:\/?$/.test(slashed)) return slashed.endsWith('/') ? slashed : `${slashed}/`;
  return slashed.length > 1 ? slashed.replace(/\/+$/, '') : slashed;
}

function getDeskDirectory(basePath: string, currentPath: string): string | null {
  if (!basePath) return null;
  const base = normalizeDirectoryPath(basePath);
  const sub = currentPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!sub) return base;
  return base.endsWith('/') ? `${base}${sub}` : `${base}/${sub}`;
}

function useDeskDirectoryWatcher(basePath: string, currentPath: string): void {
  useEffect(() => {
    const watchedDir = getDeskDirectory(basePath, currentPath);
    const platform = window.platform;
    if (!watchedDir || !platform?.watchFile || !platform?.unwatchFile) return;

    let closed = false;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const watchedKey = normalizeDirectoryPath(watchedDir);

    const unsubscribe = subscribeFileChanges((changedPath) => {
      if (normalizeDirectoryPath(changedPath) !== watchedKey) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        if (closed) return;
        const state = useStore.getState();
        const currentDir = getDeskDirectory(state.deskBasePath, state.deskCurrentPath);
        if (!currentDir || normalizeDirectoryPath(currentDir) !== watchedKey) return;
        void loadDeskFiles();
      }, DESK_RELOAD_DEBOUNCE_MS);
    });

    void platform.watchFile(watchedDir)
      .then((ok) => {
        if (!ok) console.warn('[desk] directory watch failed:', watchedDir);
        if (closed && ok) void platform.unwatchFile(watchedDir);
      })
      .catch((err) => {
        console.warn('[desk] directory watch failed:', err);
      });

    return () => {
      closed = true;
      unsubscribe();
      if (reloadTimer) clearTimeout(reloadTimer);
      void platform.unwatchFile(watchedDir);
    };
  }, [basePath, currentPath]);
}

export function DeskSection() {
  useStore(s => s.deskFiles);
  const deskBasePath = useStore(st => st.deskBasePath);
  const deskCurrentPath = useStore(st => st.deskCurrentPath);
  const selectedFolder = useStore(st => st.selectedFolder);
  const homeFolder = useStore(st => st.homeFolder);
  useDeskDirectoryWatcher(deskBasePath, deskCurrentPath);

  const [sortMode, setSortMode] = useState<SortMode>(
    () => (localStorage.getItem(DESK_SORT_KEY) as SortMode) || 'mtime-desc',
  );

  // ── 共享 context menu 状态 ──
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);

  const handleShowMenu = useCallback((state: CtxMenuState) => {
    setCtxMenu(state);
  }, []);

  const handleCloseMenu = useCallback(() => {
    setCtxMenu(null);
  }, []);

  const t = window.t ?? ((p: string) => p);
  const rootName = workspaceDisplayName(deskBasePath || selectedFolder || homeFolder, t('desk.title'));
  const workspaceTitle = t('desk.workspaceTitle');
  const title = `${workspaceTitle} · ${rootName}`;

  return (
    <>
      <DeskDropZone onShowMenu={handleShowMenu}>
        <div className={s.header}>
          <div className={`jian-section-title ${s.sectionTitle}`} title={deskBasePath || selectedFolder || homeFolder || undefined}>
            {title}
          </div>
          <DeskCwdSkillsButton />
        </div>
        <DeskOpenButton />
        <DeskCwdSkillsPanel />
        <div className={s.toolbar}>
          <DeskBreadcrumb />
          <div className={s.toolbarActions}>
            <DeskRefreshButton />
            <DeskSortButton sortMode={sortMode} onSort={setSortMode} onShowMenu={handleShowMenu} />
          </div>
        </div>
        <DeskFileList sortMode={sortMode} onShowMenu={handleShowMenu} />
        <JianEditor />
        <DeskEmptyOverlay />
      </DeskDropZone>
      {ctxMenu && (
        <ContextMenu
          items={ctxMenu.items}
          position={ctxMenu.position}
          onClose={handleCloseMenu}
        />
      )}
    </>
  );
}
