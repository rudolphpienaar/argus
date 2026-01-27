/**
 * @file Gather Stage Logic
 * 
 * Handles VFS generation and cost estimation.
 * 
 * @module
 */

import { state, globals } from '../state/store.js';
import { costEstimate_calculate } from '../logic/costs.js';
import { filesystem_create } from '../logic/filesystem.js';
import type { FileNode } from '../models/types.js';
import { cascade_update } from '../logic/telemetry.js';

export function filesystem_build(): void {
    const root: FileNode = filesystem_create(state.selectedDatasets);
    state.virtualFilesystem = root;
    fileTree_render(root);

    if (globals.terminal) {
        globals.terminal.mount(root);
    }
}

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

export function costs_calculate(): void {
    state.costEstimate = costEstimate_calculate(state.selectedDatasets);

    const costData = document.getElementById('cost-data');
    const costCompute = document.getElementById('cost-compute');
    const costStorage = document.getElementById('cost-storage');
    const costTotal = document.getElementById('cost-total');

    if (costData) costData.textContent = `$${state.costEstimate.dataAccess.toFixed(2)}`;
    if (costCompute) costCompute.textContent = `$${state.costEstimate.compute.toFixed(2)}`;
    if (costStorage) costStorage.textContent = `$${state.costEstimate.storage.toFixed(2)}`;
    if (costTotal) costTotal.textContent = `$${state.costEstimate.total.toFixed(2)}`;

    cascade_update();
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

function stageButton_setEnabled(stageName: string, enabled: boolean): void {
    const indicator = document.querySelector(`.stage-indicator[data-stage="${stageName}"]`) as HTMLElement;
    if (indicator) {
        indicator.classList.toggle('disabled', !enabled);
    }
}
