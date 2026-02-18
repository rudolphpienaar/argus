/**
 * @file Dataset Detail Overlay Controller
 *
 * Orchestrates open/close/populate lifecycle for dataset detail overlay.
 *
 * @module core/stages/gather/controllers/datasetDetail/overlay
 */

import { store } from '../../../../state/store.js';
import { DATASETS } from '../../../../data/datasets.js';
import { overlaySlots_clear } from '../../../../logic/OverlayUtils.js';
import type { Dataset } from '../../../../models/types.js';
import type { FileNode as VcsFileNode } from '../../../../../vfs/types.js';
import { cohortTree_build } from '../../../../../vfs/providers/DatasetProvider.js';
import { gatherStage_state } from '../../runtime/state.js';
import { fileCount_total } from '../../utils/tree.js';
import { overlay_closeAnimated, overlay_revealAfterTerminalCollapse } from '../../ui/overlay.js';
import { datasetGather_commit, gather_execute } from './gather.js';
import type { DatasetDetailDeps, DatasetGatherCommit } from './types.js';
import {
    datasetDetailBrowser_reset,
    datasetDetailContent_render,
    datasetDetailHeader_render,
    datasetDetailSidebar_render,
    datasetDetailTempBase_resolve,
    datasetDetailTempTree_mount,
    datasetDetailTempTree_unmount,
} from './view.js';

/**
 * Open dataset-detail overlay for a specific dataset.
 */
export function datasetDetail_open(datasetId: string, deps: DatasetDetailDeps): void {
    const dataset: Dataset | undefined = DATASETS.find((entry: Dataset): boolean => entry.id === datasetId);
    if (!dataset) {
        return;
    }

    gatherStage_state.activeDetailDataset = dataset;

    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    const lcarsFrame: HTMLElement | null = document.getElementById('detail-lcars-frame');
    if (!overlay || !lcarsFrame) {
        return;
    }

    datasetDetail_populate(dataset, overlay, lcarsFrame, deps);
    overlay_revealAfterTerminalCollapse(overlay, store.globals.frameSlot);
}

/**
 * Gather an entire dataset directly from search card action.
 */
export function dataset_add(datasetId: string, deps: DatasetDetailDeps): void {
    const dataset: Dataset | undefined = DATASETS.find((entry: Dataset): boolean => entry.id === datasetId);
    if (!dataset) {
        return;
    }

    if (gatherStage_state.gatheredDatasets.has(datasetId)) {
        datasetDetail_open(datasetId, deps);
        return;
    }

    const dataRoot: VcsFileNode = cohortTree_build([dataset]);
    gather_execute(dataset, dataRoot, [], deps);

    if (store.globals.terminal) {
        store.globals.terminal.println(`● GATHERED: [${dataset.id}] ${dataset.name}`);
        store.globals.terminal.println('○ FULL DATASET MOUNTED.');
    }
}

/**
 * Populate dataset-detail slots and command actions.
 */
function datasetDetail_populate(
    dataset: Dataset,
    overlay: HTMLElement,
    lcarsFrame: HTMLElement,
    deps: DatasetDetailDeps,
): void {
    overlay.dataset.mode = 'dataset';
    datasetDetailHeader_render(dataset, lcarsFrame);

    const dataRoot: VcsFileNode = cohortTree_build([dataset]);
    const totalFiles: number = fileCount_total(dataRoot);
    const costPerFile: number = totalFiles > 0 ? dataset.cost / totalFiles : 0;
    const tempBase: string = datasetDetailTempBase_resolve(dataset.id);

    datasetDetailTempTree_mount(tempBase, dataRoot);
    datasetDetailSidebar_render();
    datasetDetailContent_render(tempBase, dataRoot, totalFiles, costPerFile);
    datasetDetailCommands_render(deps);
}

/**
 * Render command pills and bind dataset gather actions.
 */
function datasetDetailCommands_render(deps: DatasetDetailDeps): void {
    const commandSlot: HTMLElement | null = document.getElementById('overlay-command-slot');
    if (!commandSlot) {
        return;
    }

    commandSlot.style.setProperty('--module-color', 'var(--sky)');
    commandSlot.innerHTML = `
        <button class="pill-btn done-pill" id="dataset-done-btn">
            <span class="btn-text">DONE</span>
        </button>
        <button class="pill-btn additional-data-pill" id="dataset-additional-btn">
            <span class="btn-text">ADD</span>
        </button>
        <button class="pill-btn close-pill" id="dataset-close-btn">
            <span class="btn-text">CANCEL</span>
        </button>
    `;

    document.getElementById('dataset-done-btn')?.addEventListener('click', (event: Event): void => {
        event.stopPropagation();
        datasetDetail_done(deps);
    });

    document.getElementById('dataset-additional-btn')?.addEventListener('click', (event: Event): void => {
        event.stopPropagation();
        datasetDetail_additionalData(deps);
    });

    document.getElementById('dataset-close-btn')?.addEventListener('click', (event: Event): void => {
        event.stopPropagation();
        datasetDetail_close();
    });
}

/**
 * Commit selected dataset subtree and close detail overlay.
 */
function datasetDetail_done(deps: DatasetDetailDeps): void {
    const commit: DatasetGatherCommit | null = datasetGather_commit(deps);
    if (!commit) {
        return;
    }

    datasetDetail_close();

    if (store.globals.terminal) {
        store.globals.terminal.println(`● GATHERED: [${commit.dataset.name.toUpperCase()}]`);
        store.globals.terminal.println(`○ ${commit.selectedCount} FILES SELECTED.`);
    }
}

/**
 * Commit selected subtree and return user to search workspace for more datasets.
 */
function datasetDetail_additionalData(deps: DatasetDetailDeps): void {
    const commit: DatasetGatherCommit | null = datasetGather_commit(deps);
    if (!commit) {
        return;
    }

    datasetDetail_close();

    if (store.globals.terminal) {
        store.globals.terminal.println(`● GATHERED: [${commit.dataset.name.toUpperCase()}]`);
        store.globals.terminal.println('○ SELECT ADDITIONAL DATASETS TO CONTINUE GATHERING.');
    }
}

/**
 * Close dataset detail overlay without additional state mutations.
 */
function datasetDetail_close(): void {
    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    if (!overlay || overlay.classList.contains('hidden')) {
        return;
    }

    datasetDetailBrowser_reset();

    if (gatherStage_state.activeDetailDataset) {
        datasetDetailTempTree_unmount(gatherStage_state.activeDetailDataset.id);
    }
    gatherStage_state.activeDetailDataset = null;

    overlaySlots_clear();
    overlay.dataset.mode = 'marketplace';

    overlay_closeAnimated(overlay, (): void => {
        if (store.globals.frameSlot && !store.globals.frameSlot.state_isOpen()) {
            store.globals.frameSlot.frame_open();
        }
    });
}
