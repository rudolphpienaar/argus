/**
 * @file Search Stage Logic
 *
 * Composition root for Search-stage discovery orchestration.
 *
 * Responsibilities:
 * - Handle AI/runtime authentication for discovery mode.
 * - Execute catalog filtering and query-driven result rendering.
 * - Render search-result workspace surface while delegating gather-specific
 *   state/projections to Gather-stage modules.
 *
 * @module core/stages/search
 */

import { store } from '../state/store.js';
import { DATASETS } from '../data/datasets.js';
import type { Dataset } from '../models/types.js';
import {
    lcarslm_initialize,
    lcarslm_auth,
    lcarslm_reset,
    lcarslm_simulate,
} from './search/controllers/auth.js';
import {
    dataset_select,
    dataset_deselect,
    dataset_toggle,
} from './search/actions/selection.js';
import { gatherStage_state, type GatheredEntry } from './gather/runtime/state.js';
import { workspaceHtml_render } from './gather/ui/view.js';
import { projectStrip_render } from './gather.js';

export {
    lcarslm_initialize,
    lcarslm_auth,
    lcarslm_reset,
    lcarslm_simulate,
    dataset_select,
    dataset_deselect,
    dataset_toggle,
};

/**
 * Search dataset catalog with fallback to legacy field filters.
 */
export async function catalog_search(overrideQuery?: string): Promise<Dataset[]> {
    const nlQuery: string = (document.getElementById('search-nl-input') as HTMLInputElement)?.value || '';

    if (store.globals.lcarsEngine && nlQuery.trim().length > 0 && !overrideQuery) {
        // AI search path intentionally delegated elsewhere for now.
    }

    const query: string = overrideQuery || (document.getElementById('search-query') as HTMLInputElement)?.value.toLowerCase() || '';
    const modality: string = (document.getElementById('search-modality') as HTMLSelectElement)?.value || '';
    const annotation: string = (document.getElementById('search-annotation') as HTMLSelectElement)?.value || '';

    const filtered: Dataset[] = DATASETS.filter((dataset: Dataset): boolean => {
        const matchesQuery: boolean = !query
            || dataset.name.toLowerCase().includes(query.toLowerCase())
            || dataset.description.toLowerCase().includes(query.toLowerCase());
        const matchesModality: boolean = !modality || dataset.modality === modality;
        const matchesAnnotation: boolean = !annotation || dataset.annotationType === annotation;
        return matchesQuery && matchesModality && matchesAnnotation;
    });

    const isSearchActive: boolean = query.trim() !== '' || modality !== '' || annotation !== '';
    workspace_render(filtered, isSearchActive);

    return filtered;
}

/**
 * Render search workspace grid and gathered dataset card store.state.
 */
export function workspace_render(datasets: Dataset[], isSearchActive: boolean): void {
    projectStrip_render();

    const container: HTMLElement | null = document.getElementById('dataset-results');
    if (!container) {
        return;
    }

    const gatheredEntries: GatheredEntry[] = Array.from(gatherStage_state.gatheredDatasets.values());
    container.innerHTML = workspaceHtml_render({
        searchResults: datasets,
        gatheredDatasets: gatheredEntries.map((entry: GatheredEntry): Dataset => entry.dataset),
        gatheredDatasetIds: new Set<string>(gatheredEntries.map((entry: GatheredEntry): string => entry.dataset.id)),
        isQueryActive: isSearchActive,
    });

    gatherStage_state.gatheredDatasets.forEach((_entry: GatheredEntry, datasetId: string): void => {
        const card: HTMLElement | null = container.querySelector(`[data-id="${datasetId}"]`);
        if (card) {
            card.classList.add('gathered');
        }
    });
}

/**
 * Search-stage enter hook.
 */
export function stage_enter(): void {
    if (!store.globals.frameSlot) {
        return;
    }

    setTimeout((): void => {
        store.globals.frameSlot?.frame_open();
        setTimeout((): void => {
            store.globals.shell?.command_execute('/greet');
        }, 800);
    }, 10);
}

/**
 * Search-stage exit hook.
 */
export function stage_exit(): void {
    // No-op. Teardown is handled by specific transition handlers.
}
