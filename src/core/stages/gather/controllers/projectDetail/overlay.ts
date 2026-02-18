/**
 * @file Project Detail Overlay Controller
 *
 * Orchestrates open/close/populate lifecycle for project detail overlay.
 *
 * @module core/stages/gather/controllers/projectDetail/overlay
 */

import { store } from '../../../../state/store.js';
import { MOCK_PROJECTS } from '../../../../data/projects.js';
import { overlaySlots_clear } from '../../../../logic/OverlayUtils.js';
import { projectContext_get } from '../../../../logic/ProjectContext.js';
import type { Project } from '../../../../models/types.js';
import { gatherStage_state } from '../../runtime/state.js';
import { overlay_closeAnimated, overlay_revealAfterTerminalCollapse } from '../../ui/overlay.js';
import { workspace_collapse } from '../../workspace/lifecycle.js';
import { projectDetailCommands_render } from './commands.js';
import {
    projectDetailContent_render,
    projectDetailHeader_render,
    projectDetailSidebar_render,
    projectDetailTabPath_resolve,
    projectDetailTabs_build,
    projectDetailTrees_build,
    type ProjectDetailPaths,
} from './view.js';
import type { ProjectDetailDeps } from './types.js';

/**
 * Open project-detail overlay for the selected project.
 */
export function projectDetail_open(projectId: string, deps: ProjectDetailDeps): void {
    const project: Project | undefined = MOCK_PROJECTS.find((entry: Project): boolean => entry.id === projectId);
    if (!project) {
        return;
    }

    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    const lcarsFrame: HTMLElement | null = document.getElementById('detail-lcars-frame');
    if (!overlay || !lcarsFrame) {
        return;
    }

    projectDetail_populate(project, projectId, overlay, lcarsFrame, deps);
    overlay_revealAfterTerminalCollapse(overlay, store.globals.frameSlot);
}

/**
 * Populate project-detail slots and action handlers.
 */
function projectDetail_populate(
    project: Project,
    projectId: string,
    overlay: HTMLElement,
    lcarsFrame: HTMLElement,
    deps: ProjectDetailDeps,
): void {
    const paths: ProjectDetailPaths = projectContext_get(project);
    const projectBase: string = paths.root;

    overlay.dataset.mode = 'project';
    projectDetailHeader_render(project, lcarsFrame);

    if (!store.globals.vcs.node_stat(projectBase)) {
        store.globals.vcs.dir_create(projectBase);
    }

    const trees = projectDetailTrees_build(paths);
    const tabs = projectDetailTabs_build(trees);
    const activeTab: string = 'root';

    projectDetailSidebar_render(tabs, activeTab, projectDetailTab_activate);
    projectDetailContent_render(project, projectBase, trees);
    projectDetailCommands_render({
        project,
        projectId,
        deps,
        onClose: projectDetail_close,
        onRefresh: (): void => {
            projectDetail_populate(project, projectId, overlay, lcarsFrame, deps);
        },
    });
}

/**
 * Close project-detail overlay with standard animation lifecycle.
 */
function projectDetail_close(): void {
    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    if (!overlay || overlay.classList.contains('hidden')) {
        return;
    }

    if (gatherStage_state.isWorkspaceExpanded) {
        workspace_collapse();
        if (store.globals.frameSlot && store.globals.frameSlot.state_isOpen()) {
            store.globals.frameSlot.frame_close();
        }
    }

    if (gatherStage_state.detailBrowser) {
        gatherStage_state.detailBrowser.destroy();
        gatherStage_state.detailBrowser = null;
    }

    overlaySlots_clear();
    overlay.dataset.mode = 'marketplace';

    overlay_closeAnimated(overlay, (): void => {
        if (store.globals.frameSlot && !store.globals.frameSlot.state_isOpen()) {
            store.globals.frameSlot.frame_open();
        }
    });
}

/**
 * Activate selected tab in browser and synchronize terminal cwd when expanded.
 */
function projectDetailTab_activate(tabId: string, sidebarSlot: HTMLElement): void {
    sidebarSlot.querySelectorAll<HTMLElement>('.lcars-panel').forEach((panel: HTMLElement): void => {
        panel.classList.toggle('active', panel.dataset.panelId === tabId);
    });

    if (gatherStage_state.detailBrowser) {
        gatherStage_state.detailBrowser.tab_switch(tabId);
    }

    if (!gatherStage_state.isWorkspaceExpanded || !gatherStage_state.workspaceProjectBase) {
        return;
    }

    const targetPath: string = projectDetailTabPath_resolve(tabId, gatherStage_state.workspaceProjectBase);
    store.globals.vcs.cwd_set(targetPath);
    if (store.globals.terminal) {
        store.globals.terminal.prompt_sync();
    }
}
