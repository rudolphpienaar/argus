/**
 * @file Dataset Detail Controller Types
 *
 * Shared contracts for Gather-stage dataset detail modules.
 *
 * @module core/stages/gather/controllers/datasetDetail/types
 */

import type { Dataset } from '../../../../models/types.js';

/**
 * Dependencies provided by Gather-stage orchestration.
 */
export interface DatasetDetailDeps {
    projectStrip_render(): void;
}

/**
 * Result payload from a committed dataset gather action.
 */
export interface DatasetGatherCommit {
    dataset: Dataset;
    selectedCount: number;
}
