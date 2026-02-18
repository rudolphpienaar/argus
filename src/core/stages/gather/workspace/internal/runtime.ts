/**
 * @file Workspace Runtime Hooks
 *
 * Runtime state mutations for Gather workspace activation.
 *
 * @module core/stages/gather/workspace/internal/runtime
 */

import { store } from '../../../../state/store.js';
import type { Project } from '../../../../models/types.js';
import type { FileNode as VcsFileNode } from '../../../../../vfs/types.js';
import { cohortTree_build } from '../../../../../vfs/providers/DatasetProvider.js';
import { gatherStage_state } from '../../runtime/state.js';
import { workspaceTab_resolveFromCwd } from '../../utils/workspacePaths.js';

/**
 * Mount project scaffolding and input cohort into VFS context.
 */
export function workspaceProject_mount(
    project: Project,
    projectRootPath: string,
    inputPath: string,
    srcPath: string,
): void {
    store.project_load(project);

    const cohortRoot: VcsFileNode = cohortTree_build(project.datasets);
    try {
        store.globals.vcs.dir_create(inputPath);
    } catch {
        // Path may already exist.
    }

    store.globals.vcs.tree_unmount(inputPath);
    store.globals.vcs.dir_create(srcPath);
    store.globals.vcs.tree_mount(inputPath, cohortRoot);
    store.globals.vcs.cwd_set(projectRootPath);

    if (store.globals.shell) {
        store.globals.shell.env_set('PROJECT', project.name);
    }
}

/**
 * Open terminal view, apply default split ratio, and print context logs.
 */
export function workspaceTerminal_open(
    rightFrame: HTMLElement,
    consoleEl: HTMLElement,
    project: Project,
): void {
    if (store.globals.frameSlot && !store.globals.frameSlot.state_isOpen()) {
        store.globals.frameSlot.frame_open();
    }

    setTimeout((): void => {
        const frameHeight: number = rightFrame.clientHeight;
        const terminalHeight: number = Math.round(frameHeight * 0.3);
        consoleEl.style.height = `${terminalHeight}px`;
        consoleEl.style.transition = 'none';
        requestAnimationFrame((): void => {
            consoleEl.style.transition = '';
        });
    }, 100);

    if (store.globals.terminal) {
        store.globals.terminal.prompt_sync();
        store.globals.terminal.println(`● MOUNTING PROJECT: [${project.name.toUpperCase()}]`);
        store.globals.terminal.println(`○ LOADED ${project.datasets.length} DATASETS.`);
        store.globals.terminal.println('○ WORKSPACE ACTIVE. FILE BROWSER READY.');
    }
}

/**
 * Keep sidebar tab state synchronized with shell cwd changes.
 */
export function workspaceShellSync_register(): void {
    if (!store.globals.shell) {
        return;
    }

    store.globals.shell.onCwdChange_set((newCwd: string): void => {
        if (!gatherStage_state.isWorkspaceExpanded || !gatherStage_state.detailBrowser) {
            return;
        }

        const tabId: string | null = workspaceTab_resolveFromCwd(newCwd, gatherStage_state.workspaceProjectBase);
        if (!tabId || tabId === gatherStage_state.detailBrowser.activeTab_get()) {
            return;
        }

        gatherStage_state.detailBrowser.tab_switch(tabId);
        const sidebarSlot: HTMLElement | null = document.getElementById('overlay-sidebar-slot');
        if (!sidebarSlot) {
            return;
        }

        sidebarSlot.querySelectorAll<HTMLElement>('.lcars-panel').forEach((panel: HTMLElement): void => {
            panel.classList.toggle('active', panel.dataset.panelId === tabId);
        });
    });
}

/**
 * Remove shell cwd synchronization hook.
 */
export function workspaceShellSync_unregister(): void {
    if (store.globals.shell) {
        store.globals.shell.onCwdChange_set(null);
    }
}

/**
 * Destroy active detail browser instance.
 */
export function workspaceDetailBrowser_reset(): void {
    if (gatherStage_state.detailBrowser) {
        gatherStage_state.detailBrowser.destroy();
        gatherStage_state.detailBrowser = null;
    }
}
