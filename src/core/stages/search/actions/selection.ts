/**
 * @file Search Dataset Selection Actions
 *
 * Selection primitives for Search-stage dataset cards.
 *
 * Responsibilities:
 * - Resolve datasets by ID against catalog.
 * - Mutate centralized store selection store.state.
 * - Reflect selection state in card DOM affordances.
 * - Emit terminal feedback for operator awareness.
 *
 * @module core/stages/search/actions/selection
 */

import { store } from '../../../state/store.js';
import { DATASETS } from '../../../data/datasets.js';
import type { Dataset } from '../../../models/types.js';

/**
 * Select a dataset by ID and sync UI/store store.state.
 */
export function dataset_select(datasetId: string, quiet: boolean = false): void {
    const dataset: Dataset | undefined = DATASETS.find((entry: Dataset): boolean => entry.id === datasetId);
    if (!dataset) {
        return;
    }

    store.dataset_select(dataset);
    const card: Element | null = document.querySelector(`.market-card[data-id="${datasetId}"]`);
    if (card) {
        card.classList.add('selected');
    }

    if (!quiet && store.globals.terminal) {
        store.globals.terminal.println(`● SELECTED DATASET: [${dataset.id}] ${dataset.name}`);
        store.globals.terminal.println('○ ADDED TO COHORT BUFFER. SELECT MORE OR PROCEED TO CODE.');
    }
}

/**
 * Deselect a dataset by ID and sync UI/store store.state.
 */
export function dataset_deselect(datasetId: string, quiet: boolean = false): void {
    const dataset: Dataset | undefined = DATASETS.find((entry: Dataset): boolean => entry.id === datasetId);
    if (!dataset) {
        return;
    }

    store.dataset_deselect(datasetId);
    const card: Element | null = document.querySelector(`.market-card[data-id="${datasetId}"]`);
    if (card) {
        card.classList.remove('selected');
    }

    if (!quiet && store.globals.terminal) {
        store.globals.terminal.println(`○ DESELECTED DATASET: [${datasetId}] ${dataset.name}`);
    }
}

/**
 * Toggle dataset selection state by ID.
 */
export function dataset_toggle(datasetId: string): void {
    const selected: boolean = store.state.selectedDatasets.some((entry: Dataset): boolean => entry.id === datasetId);
    if (selected) {
        dataset_deselect(datasetId);
        return;
    }
    dataset_select(datasetId);
}
