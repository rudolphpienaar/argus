/**
 * @file Dataset Detail Gather Logic
 *
 * Gather commit and persistence logic for Gather-stage dataset detail flow.
 *
 * @module core/stages/gather/controllers/datasetDetail/gather
 */

import { project_gather } from '../../../../logic/ProjectManager.js';
import type { Dataset } from '../../../../models/types.js';
import type { FileNode as VcsFileNode } from '../../../../../vfs/types.js';
import { cohortTree_build } from '../../../../../vfs/providers/DatasetProvider.js';
import { gatherStage_state, type GatheredEntry } from '../../runtime/state.js';
import { fileCount_total } from '../../utils/tree.js';
import type { DatasetDetailDeps, DatasetGatherCommit } from './types.js';

/**
 * Persist gathered subtree, mount into project, and update card-strip state.
 */
export function gather_execute(
    dataset: Dataset,
    subtree: VcsFileNode,
    selectedPaths: string[],
    deps: DatasetDetailDeps,
): void {
    const gatheredEntry: GatheredEntry = {
        dataset,
        selectedPaths,
        subtree,
    };
    gatherStage_state.gatheredDatasets.set(dataset.id, gatheredEntry);

    const project = project_gather(dataset, subtree, gatherStage_state.gatherTargetProject);
    gatherStage_state.gatherTargetProject = project;
    deps.projectStrip_render();

    const card: Element | null = document.querySelector(`.market-card[data-id="${dataset.id}"]`);
    if (!card) {
        return;
    }

    card.classList.add('gathered');
    const buttonEl: Element | null = card.querySelector('.install-btn');
    if (!buttonEl) {
        return;
    }

    buttonEl.classList.add('installed');
    const buttonTextEl: Element | null = buttonEl.querySelector('.btn-text');
    if (buttonTextEl) {
        buttonTextEl.textContent = 'GATHERED';
    }
}

/**
 * Commit dataset browser selection into gathered dataset registry.
 */
export function datasetGather_commit(deps: DatasetDetailDeps): DatasetGatherCommit | null {
    const activeDataset: Dataset | null = gatherStage_state.activeDetailDataset;
    if (!gatherStage_state.datasetBrowser || !activeDataset) {
        return null;
    }

    const dataRoot: VcsFileNode = cohortTree_build([activeDataset]);
    const selectedPaths: string[] = gatherStage_state.datasetBrowser.selection_get();
    const subtree: VcsFileNode | null = selectedPaths.length === 0
        ? dataRoot
        : gatherStage_state.datasetBrowser.selectionSubtree_extract(dataRoot);

    if (!subtree) {
        return null;
    }

    gather_execute(activeDataset, subtree, selectedPaths, deps);

    const selectedCount: number = selectedPaths.length > 0
        ? selectedPaths.length
        : fileCount_total(subtree);

    return {
        dataset: activeDataset,
        selectedCount,
    };
}
