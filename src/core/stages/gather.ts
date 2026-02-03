/**
 * @file Gather Stage Logic
 *
 * Handles VFS generation, cost estimation, and file preview
 * for the Gather stage of the SeaGaP workflow.
 *
 * @module
 */

import { state, globals, store } from '../state/store.js';
import { events, Events } from '../state/events.js';
import { costEstimate_calculate } from '../logic/costs.js';
import { cohortTree_build } from '../../vfs/providers/DatasetProvider.js';
import type { FileNode as VcsFileNode } from '../../vfs/types.js';
import type { CostEstimate } from '../models/types.js';

// ============================================================================
// Lifecycle Hooks
// ============================================================================

/**
 * Hook called when entering the Gather stage.
 * Rebuilds the filesystem and recalculates costs.
 */
export function stage_enter(): void {
    filesystem_build();
    costs_calculate();
}

/**
 * Hook called when exiting the Gather stage.
 */
export function stage_exit(): void {
    // Teardown if needed
}

// ============================================================================
// Filesystem Generation
// ============================================================================

/**
 * Builds the VFS cohort tree from the currently selected datasets.
 * Renders the tree in the Gather stage UI and mounts it to the VCS.
 */
export function filesystem_build(): void {
    const cohortRoot: VcsFileNode = cohortTree_build(state.selectedDatasets);

    fileTree_render(cohortRoot);

    globals.vcs.tree_unmount('/home/fedml/data/cohort');
    globals.vcs.tree_mount('/home/fedml/data/cohort', cohortRoot);
}

// ============================================================================
// Cost Estimation
// ============================================================================

/**
 * Calculates and displays the cost estimate for the current dataset selection.
 * Updates the Store and renders cost values into the Gather stage UI.
 */
export function costs_calculate(): void {
    const estimate: CostEstimate = costEstimate_calculate(state.selectedDatasets);
    store.cost_update(estimate);

    const costData: HTMLElement | null = document.getElementById('cost-data');
    const costCompute: HTMLElement | null = document.getElementById('cost-compute');
    const costStorage: HTMLElement | null = document.getElementById('cost-storage');
    const costTotal: HTMLElement | null = document.getElementById('cost-total');

    if (costData) costData.textContent = `$${state.costEstimate.dataAccess.toFixed(2)}`;
    if (costCompute) costCompute.textContent = `$${state.costEstimate.compute.toFixed(2)}`;
    if (costStorage) costStorage.textContent = `$${state.costEstimate.storage.toFixed(2)}`;
    if (costTotal) costTotal.textContent = `$${state.costEstimate.total.toFixed(2)}`;

    stageButton_setEnabled('process', true);
}

// ============================================================================
// Selection Count
// ============================================================================

/**
 * Updates the selection count display and enables/disables
 * the Gather stage navigation button based on selection state.
 */
export function selectionCount_update(): void {
    const count: number = state.selectedDatasets.length;
    const countEl: HTMLElement | null = document.getElementById('selection-count');
    const btnToGather: HTMLButtonElement | null = document.getElementById('btn-to-gather') as HTMLButtonElement;

    console.log(`ARGUS: selectionCount_update called. Count: ${count}, Element found: ${!!countEl}`);

    if (countEl) {
        countEl.textContent = `${count} dataset${count !== 1 ? 's' : ''} selected`;
    }

    if (btnToGather) {
        btnToGather.disabled = count === 0;
    }

    stageButton_setEnabled('gather', count > 0);
}

// ============================================================================
// Event Subscriptions
// ============================================================================

events.on(Events.DATASET_SELECTION_CHANGED, (): void => {
    selectionCount_update();
    if (state.currentStage === 'gather') {
        filesystem_build();
        costs_calculate();
    }
});

// ============================================================================
// File Tree Rendering
// ============================================================================

/**
 * Renders a VFS file tree into the Gather stage file-tree container.
 *
 * @param node - The root VCS FileNode to render.
 */
function fileTree_render(node: VcsFileNode): void {
    const container: HTMLElement | null = document.getElementById('file-tree');
    if (!container) return;

    function nodeHtml_build(n: VcsFileNode): string {
        const typeClass: string = n.type;
        if (n.children && n.children.length > 0) {
            return `
                <li class="${typeClass}">${n.name}
                    <ul>${n.children.map(nodeHtml_build).join('')}</ul>
                </li>
            `;
        }
        return `<li class="${typeClass}" onclick="filePreview_show('${n.path}', '${n.type}')">${n.name}</li>`;
    }

    container.innerHTML = `<ul>${nodeHtml_build(node)}</ul>`;
}

// ============================================================================
// File Preview
// ============================================================================

/**
 * Displays a file preview in the Gather stage preview panel.
 * Shows image thumbnails for image files and placeholder text for others.
 *
 * @param path - The VFS path of the file to preview.
 * @param type - The file type ('file', 'folder', 'image').
 */
export function filePreview_show(path: string, type: string): void {
    const preview: HTMLElement | null = document.getElementById('file-preview');
    if (!preview) return;

    if (type === 'image' && path) {
        preview.innerHTML = `<img src="${path}" alt="Preview">`;
    } else if (type === 'file') {
        preview.innerHTML = `<p class="dim">File preview not available</p>`;
    } else {
        preview.innerHTML = `<p class="dim">Select a file to preview</p>`;
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Enables or disables a stage indicator button.
 *
 * @param stageName - The stage to enable/disable.
 * @param enabled - Whether to enable the indicator.
 */
function stageButton_setEnabled(stageName: string, enabled: boolean): void {
    const indicator: HTMLElement | null = document.querySelector(`.stage-indicator[data-stage="${stageName}"]`) as HTMLElement;
    if (indicator) {
        indicator.classList.toggle('disabled', !enabled);
    }
}
