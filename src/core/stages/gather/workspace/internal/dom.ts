/**
 * @file Workspace DOM Mechanics
 *
 * DOM-structure and resize-handle mechanics for Gather workspace mode.
 *
 * @module core/stages/gather/workspace/internal/dom
 */

import { gatherStage_state } from '../../runtime/state.js';
import { resizeHandle_attach } from '../../../../../ui/interactions/ResizeHandle.js';

/**
 * Required DOM references for workspace orchestration.
 */
export interface WorkspaceDomElements {
    overlay: HTMLElement;
    layout: HTMLElement;
    rightFrame: HTMLElement;
    consoleEl: HTMLElement;
    commandSlot: HTMLElement | null;
}

/**
 * Resolve required workspace DOM references.
 */
export function workspaceDomElements_resolve(): WorkspaceDomElements | null {
    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    const layout: HTMLElement | null = overlay?.querySelector('.detail-layout') as HTMLElement | null;
    const rightFrame: HTMLElement | null = document.querySelector('.right-frame') as HTMLElement | null;
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');
    const commandSlot: HTMLElement | null = document.getElementById('overlay-command-slot');

    if (!overlay || !layout || !rightFrame || !consoleEl) {
        return null;
    }

    return {
        overlay,
        layout,
        rightFrame,
        consoleEl,
        commandSlot,
    };
}

/**
 * Activate expanded workspace layout.
 */
export function workspaceLayout_activate(elements: WorkspaceDomElements): void {
    elements.layout.classList.add('workspace-expanded');
    elements.overlay.dataset.workspace = 'true';
    elements.overlay.classList.add('workspace-expanded');

    const marketplaceOverlay: HTMLElement | null = document.getElementById('marketplace-overlay');
    if (marketplaceOverlay) {
        marketplaceOverlay.classList.add('hidden');
    }

    const stageContent: HTMLElement | null = document.querySelector('.stage-content[data-stage="search"]') as HTMLElement | null;
    if (stageContent) {
        stageContent.style.display = 'none';
    }

    if (elements.commandSlot) {
        elements.commandSlot.classList.add('command-col-hiding');
        elements.commandSlot.addEventListener('transitionend', (): void => {
            if (elements.commandSlot) {
                elements.commandSlot.style.display = 'none';
            }
        }, { once: true });
    }

    elements.rightFrame.classList.add('workspace-active');
}

/**
 * Restore non-workspace detail layout.
 */
export function workspaceLayout_restore(elements: WorkspaceDomElements | null): void {
    if (elements) {
        elements.rightFrame.classList.remove('workspace-active');
        elements.consoleEl.style.height = '';
        elements.consoleEl.style.transition = '';

        elements.layout.classList.remove('workspace-expanded');
        elements.overlay.classList.remove('workspace-expanded');
        elements.overlay.style.height = '';
        delete elements.overlay.dataset.workspace;

        if (elements.commandSlot) {
            elements.commandSlot.style.display = '';
            elements.commandSlot.classList.remove('command-col-hiding');
        }
    }

    const marketplaceOverlay: HTMLElement | null = document.getElementById('marketplace-overlay');
    if (marketplaceOverlay) {
        marketplaceOverlay.classList.remove('hidden');
    }

    const stageContent: HTMLElement | null = document.querySelector('.stage-content[data-stage="search"]') as HTMLElement | null;
    if (stageContent) {
        stageContent.style.display = '';
    }
}

/**
 * Attach terminal and browser resize handles.
 */
export function workspaceResizeHandles_attach(elements: WorkspaceDomElements): void {
    const terminalHandle: HTMLDivElement = document.createElement('div');
    terminalHandle.className = 'workspace-resize-handle';
    terminalHandle.dataset.target = 'terminal';
    elements.consoleEl.insertAdjacentElement('afterend', terminalHandle);

    terminalHandle.insertAdjacentElement('afterend', elements.overlay);

    const browserHandle: HTMLDivElement = document.createElement('div');
    browserHandle.className = 'workspace-resize-handle';
    browserHandle.dataset.target = 'browser';
    elements.overlay.insertAdjacentElement('afterend', browserHandle);

    gatherStage_state.workspaceDragCleanup = resizeHandle_attach({
        target: elements.consoleEl,
        handle: terminalHandle,
        minSize: 80,
        direction: 'vertical',
    });

    gatherStage_state.browserDragCleanup = resizeHandle_attach({
        target: elements.overlay,
        handle: browserHandle,
        minSize: 300,
        direction: 'vertical',
    });
}

/**
 * Remove resize handles and associated listeners.
 */
export function workspaceResizeHandles_detach(): void {
    if (gatherStage_state.workspaceDragCleanup) {
        gatherStage_state.workspaceDragCleanup();
        gatherStage_state.workspaceDragCleanup = null;
    }

    if (gatherStage_state.browserDragCleanup) {
        gatherStage_state.browserDragCleanup();
        gatherStage_state.browserDragCleanup = null;
    }

    const rightFrame: HTMLElement | null = document.querySelector('.right-frame') as HTMLElement | null;
    rightFrame?.querySelectorAll('.workspace-resize-handle').forEach((handle: Element): void => {
        handle.remove();
    });
}
