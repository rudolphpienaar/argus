/**
 * @file Gather Stage Logic
 * 
 * Handles VFS generation and cost estimation.
 * 
 * @module
 */

import { state, globals, store } from '../state/store.js';
import { events, Events } from '../state/events.js';
import { costEstimate_calculate } from '../logic/costs.js';
import { filesystem_create } from '../logic/filesystem.js';
import type { FileNode } from '../models/types.js';

export function filesystem_build(): void {
    // ... existing logic ...
    const root: FileNode = filesystem_create(state.selectedDatasets);
    // state.virtualFilesystem = root; // Replaced with action if needed, but UI uses root directly here
    fileTree_render(root);

    // Mount to global VFS
    const projectName = state.activeProject ? state.activeProject.name : 'current_cohort';
    globals.vfs.mountProject(projectName, root);
    
    // We only auto-cd if we are in the gather/process stage context, handled by navigation mostly.
}

// ... fileTree_render ...

export function costs_calculate(): void {
    const estimate = costEstimate_calculate(state.selectedDatasets);
    store.updateCost(estimate);

    // ... Update UI ...
    const costData = document.getElementById('cost-data');
    const costCompute = document.getElementById('cost-compute');
    const costStorage = document.getElementById('cost-storage');
    const costTotal = document.getElementById('cost-total');

    if (costData) costData.textContent = `$${state.costEstimate.dataAccess.toFixed(2)}`;
    if (costCompute) costCompute.textContent = `$${state.costEstimate.compute.toFixed(2)}`;
    if (costStorage) costStorage.textContent = `$${state.costEstimate.storage.toFixed(2)}`;
    if (costTotal) costTotal.textContent = `$${state.costEstimate.total.toFixed(2)}`;

    // Note: cascade_update is now handled by store event listener in telemetry.ts
    // Button enabling
    stageButton_setEnabled('process', true);
}

export function selectionCount_update(): void {
    const count: number = state.selectedDatasets.length;
    const countEl: HTMLElement | null = document.getElementById('selection-count');
    const btnToGather: HTMLButtonElement | null = document.getElementById('btn-to-gather') as HTMLButtonElement;

    if (countEl) {
        countEl.textContent = `${count} dataset${count !== 1 ? 's' : ''} selected`;
    }

    if (btnToGather) {
        btnToGather.disabled = count === 0;
    }

    stageButton_setEnabled('gather', count > 0);
}

// Subscribe to selection changes
events.on(Events.DATASET_SELECTION_CHANGED, () => {
    // If we are in the Gather stage, or just generally keeping state valid:
    selectionCount_update();
    // We don't rebuild filesystem on every click unless in Gather?
    // Actually, cost calc and selection count should update always.
    if (state.currentStage === 'gather') {
        filesystem_build();
        costs_calculate();
    }
});

// ... helpers ...
function fileTree_render(node: FileNode): void {
    const container = document.getElementById('file-tree');
    if (!container) return;

    function nodeHtml_build(n: FileNode): string {
        const typeClass = n.type;
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

export function filePreview_show(path: string, type: string): void {
    const preview = document.getElementById('file-preview');
    if (!preview) return;

    if (type === 'image' && path) {
        preview.innerHTML = `<img src="${path}" alt="Preview">`;
    } else if (type === 'file') {
        preview.innerHTML = `<p class="dim">File preview not available</p>`;
    } else {
        preview.innerHTML = `<p class="dim">Select a file to preview</p>`;
    }
}

function stageButton_setEnabled(stageName: string, enabled: boolean): void {
    const indicator = document.querySelector(`.stage-indicator[data-stage="${stageName}"]`) as HTMLElement;
    if (indicator) {
        indicator.classList.toggle('disabled', !enabled);
    }
}