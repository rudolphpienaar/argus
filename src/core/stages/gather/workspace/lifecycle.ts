/**
 * @file Gather Workspace Lifecycle
 *
 * Coordinates expansion/collapse behavior for the Gather-stage project workspace.
 *
 * Responsibilities:
 * - Expand project detail into split-pane workspace mode.
 * - Collapse workspace and restore detail overlay layout.
 * - Perform full teardown before stage transitions.
 *
 * @module core/stages/gather/workspace/lifecycle
 */

import { store } from '../../../state/store.js';
import { projectContext_get } from '../../../logic/ProjectContext.js';
import { overlaySlots_clear } from '../../../logic/OverlayUtils.js';
import type { Project } from '../../../models/types.js';
import { gatherStage_state } from '../runtime/state.js';
import {
    workspaceDomElements_resolve,
    workspaceLayout_activate,
    workspaceLayout_restore,
    workspaceResizeHandles_attach,
    workspaceResizeHandles_detach,
} from './internal/dom.js';
import {
    workspaceDetailBrowser_reset,
    workspaceProject_mount,
    workspaceShellSync_register,
    workspaceShellSync_unregister,
    workspaceTerminal_open,
} from './internal/runtime.js';
import {
    workspaceFederalizeButton_remove,
    workspaceFederalizeButton_render,
} from './internal/launch.js';

/**
 * Expand project detail into an interactive split-pane workspace.
 */
export function workspace_expand(project: Project): void {
    if (gatherStage_state.isWorkspaceExpanded) {
        return;
    }

    const elements = workspaceDomElements_resolve();
    if (!elements) {
        return;
    }

    const paths = projectContext_get(project);
    gatherStage_state.isWorkspaceExpanded = true;
    gatherStage_state.workspaceProjectBase = paths.root;

    workspaceLayout_activate(elements);
    workspaceResizeHandles_attach(elements);

    setTimeout((): void => {
        workspaceProject_mount(project, paths.root, paths.input, paths.src);
        workspaceTerminal_open(elements.rightFrame, elements.consoleEl, project);
        workspaceShellSync_register();
        workspaceFederalizeButton_render();
    }, 400);
}

/**
 * Collapse split-pane workspace and restore overlay detail layout.
 */
export function workspace_collapse(): void {
    if (!gatherStage_state.isWorkspaceExpanded) {
        return;
    }

    gatherStage_state.isWorkspaceExpanded = false;
    gatherStage_state.workspaceProjectBase = '';

    const elements = workspaceDomElements_resolve();

    workspaceResizeHandles_detach();
    workspaceLayout_restore(elements);
    workspaceShellSync_unregister();
    workspaceDetailBrowser_reset();
    workspaceFederalizeButton_remove();
}

/**
 * Fully tear down workspace and hide overlay before stage transitions.
 */
export function workspace_teardown(): void {
    if (gatherStage_state.isWorkspaceExpanded) {
        workspace_collapse();
    }

    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('closing', 'workspace-expanded');
        overlay.dataset.mode = 'marketplace';
        delete overlay.dataset.workspace;
    }

    workspaceDetailBrowser_reset();
    overlaySlots_clear();

    if (store.globals.frameSlot && store.globals.frameSlot.state_isOpen()) {
        store.globals.frameSlot.frame_close();
    }
}
