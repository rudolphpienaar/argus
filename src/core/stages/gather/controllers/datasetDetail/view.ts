/**
 * @file Dataset Detail View Helpers
 *
 * Rendering and view-state helpers for Gather-stage dataset detail overlay.
 *
 * @module core/stages/gather/controllers/datasetDetail/view
 */

import { store } from '../../../../state/store.js';
import type { Dataset } from '../../../../models/types.js';
import type { FileNode as VcsFileNode } from '../../../../../vfs/types.js';
import { FileBrowser } from '../../../../../ui/components/FileBrowser.js';
import { gatherStage_state } from '../../runtime/state.js';
import { datasetDetailContentHtml_render } from '../../ui/view.js';

/**
 * Render dataset header values and LCARS hue.
 */
export function datasetDetailHeader_render(dataset: Dataset, lcarsFrame: HTMLElement): void {
    lcarsFrame.style.setProperty('--lcars-hue', '200');

    const nameEl: HTMLElement | null = document.getElementById('detail-name');
    const typeBadge: HTMLElement | null = document.getElementById('detail-type-badge');
    const versionEl: HTMLElement | null = document.getElementById('detail-version');
    const starsEl: HTMLElement | null = document.getElementById('detail-stars');
    const authorEl: HTMLElement | null = document.getElementById('detail-author');

    if (nameEl) {
        nameEl.textContent = dataset.name.toUpperCase();
    }
    if (typeBadge) {
        typeBadge.textContent = 'DATASET';
    }
    if (versionEl) {
        versionEl.textContent = dataset.modality.toUpperCase();
    }
    if (starsEl) {
        starsEl.textContent = `${dataset.imageCount.toLocaleString()} IMAGES`;
    }
    if (authorEl) {
        authorEl.textContent = dataset.provider;
    }
}

/**
 * Resolve temporary mount base used for dataset preview browser.
 */
export function datasetDetailTempBase_resolve(datasetId: string): string {
    const username: string = store.globals.shell?.env_get('USER') || 'user';
    return `/home/${username}/datasets/${datasetId}`;
}

/**
 * Mount generated dataset tree into temporary VFS path.
 */
export function datasetDetailTempTree_mount(tempBase: string, dataRoot: VcsFileNode): void {
    try {
        store.globals.vcs.dir_create(tempBase);
    } catch {
        // Path may already exist.
    }

    store.globals.vcs.tree_unmount(`${tempBase}/data`);
    store.globals.vcs.tree_mount(`${tempBase}/data`, dataRoot);
}

/**
 * Unmount temporary dataset preview tree from VFS.
 */
export function datasetDetailTempTree_unmount(datasetId: string): void {
    const tempBase: string = datasetDetailTempBase_resolve(datasetId);
    try {
        store.globals.vcs.tree_unmount(`${tempBase}/data`);
    } catch {
        // Ignore unmount failures for already-cleaned paths.
    }
}

/**
 * Render dataset-detail sidebar slot.
 */
export function datasetDetailSidebar_render(): void {
    const sidebarSlot: HTMLElement | null = document.getElementById('overlay-sidebar-slot');
    if (!sidebarSlot) {
        return;
    }

    sidebarSlot.innerHTML = '';

    const dataPanel: HTMLAnchorElement = document.createElement('a');
    dataPanel.className = 'lcars-panel active';
    dataPanel.textContent = 'DATA';
    dataPanel.dataset.shade = '1';
    sidebarSlot.appendChild(dataPanel);

    const spacer: HTMLDivElement = document.createElement('div');
    spacer.className = 'lcars-sidebar-spacer';
    spacer.dataset.shade = '4';
    sidebarSlot.appendChild(spacer);

    const bottomPanel: HTMLAnchorElement = document.createElement('a');
    bottomPanel.className = 'lcars-panel lcars-corner-bl';
    bottomPanel.dataset.shade = '2';
    bottomPanel.textContent = 'GATHER';
    sidebarSlot.appendChild(bottomPanel);
}

/**
 * Render dataset-detail content slot and mount selectable browser.
 */
export function datasetDetailContent_render(
    tempBase: string,
    dataRoot: VcsFileNode,
    totalFiles: number,
    costPerFile: number,
): void {
    const contentSlot: HTMLElement | null = document.getElementById('overlay-content-slot');
    if (!contentSlot) {
        return;
    }

    contentSlot.innerHTML = datasetDetailContentHtml_render(totalFiles);

    const treeEl: HTMLElement | null = document.getElementById('dataset-file-tree');
    const previewEl: HTMLElement | null = document.getElementById('dataset-file-preview');
    if (!treeEl || !previewEl) {
        return;
    }

    datasetDetailBrowser_reset();

    const datasetBrowser: FileBrowser = new FileBrowser({
        treeContainer: treeEl,
        previewContainer: previewEl,
        vfs: store.globals.vcs,
        projectBase: tempBase,
        selectable: true,
        onSelectionChange: (selectedPaths: string[]): void => {
            datasetDetailCostStrip_update(selectedPaths.length, costPerFile);
        },
    });

    datasetBrowser.trees_set({ data: dataRoot });
    datasetBrowser.tree_render();
    gatherStage_state.datasetBrowser = datasetBrowser;
}

/**
 * Destroy active dataset-detail browser instance.
 */
export function datasetDetailBrowser_reset(): void {
    if (gatherStage_state.datasetBrowser) {
        gatherStage_state.datasetBrowser.destroy();
        gatherStage_state.datasetBrowser = null;
    }
}

/**
 * Update dataset gather cost strip from selected file count.
 */
function datasetDetailCostStrip_update(selectedCount: number, costPerFile: number): void {
    const countEl: HTMLElement | null = document.getElementById('gather-selected-count');
    const costEl: HTMLElement | null = document.getElementById('gather-cost-value');

    if (countEl) {
        countEl.textContent = String(selectedCount);
    }
    if (costEl) {
        costEl.textContent = `$${(selectedCount * costPerFile).toFixed(2)}`;
    }
}
