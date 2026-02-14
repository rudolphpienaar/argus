/**
 * @file Store Adapter for CalypsoCore
 *
 * Bridges CalypsoCore to the ARGUS Store without creating circular dependencies.
 * Implements CalypsoStoreActions interface.
 *
 * @module
 */

import type { CalypsoStoreActions } from '../types.js';
import type { Dataset, AppState } from '../../core/models/types.js';
import { store, state } from '../../core/state/store.js';

/**
 * Adapter that exposes Store functionality to CalypsoCore.
 */
export class StoreAdapter implements CalypsoStoreActions {
    /**
     * Get current state snapshot.
     */
    public state_get(): Partial<AppState> {
        return {
            currentStage: state.currentStage,
            selectedDatasets: [...state.selectedDatasets],
            activeProject: state.activeProject ? { ...state.activeProject } : null,
            marketplaceOpen: state.marketplaceOpen,
            installedAssets: [...state.installedAssets],
            costEstimate: { ...state.costEstimate },
            trainingJob: state.trainingJob ? { ...state.trainingJob } : null
        };
    }

    /**
     * Reset to initial state.
     */
    public reset(): void {
        store.selection_clear();
        store.project_unload();
        store.stage_set('search');
    }

    /**
     * Select a dataset.
     */
    public dataset_select(dataset: Dataset): void {
        store.dataset_select(dataset);
    }

    /**
     * Deselect a dataset by ID.
     */
    public dataset_deselect(id: string): void {
        store.dataset_deselect(id);
    }

    /**
     * Get selected datasets.
     */
    public datasets_getSelected(): Dataset[] {
        return state.selectedDatasets;
    }

    /**
     * Get active project.
     */
    public project_getActive(): { id: string; name: string } | null {
        if (state.activeProject) {
            return {
                id: state.activeProject.id,
                name: state.activeProject.name
            };
        }
        return null;
    }

    /**
     * Set current stage.
     */
    public stage_set(stage: AppState['currentStage']): void {
        store.stage_set(stage);
    }
}

/**
 * Singleton instance of the store adapter.
 */
export const storeAdapter: StoreAdapter = new StoreAdapter();
