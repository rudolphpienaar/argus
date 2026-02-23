/**
 * @file Store Adapter for CalypsoCore
 *
 * Bridges CalypsoCore to the ARGUS Store without creating circular dependencies.
 * Implements CalypsoStoreActions interface.
 *
 * @module
 */

import type { CalypsoStoreActions } from '../types.js';
import type { Dataset, AppState, Project } from '../../core/models/types.js';
import { store } from '../../core/state/store.js';
import { DATASETS } from '../../core/data/datasets.js';

/**
 * Adapter that exposes Store functionality to CalypsoCore.
 */
export class StoreAdapter implements CalypsoStoreActions {
    private sessionPath: string | null = null;

    /**
     * Get current state snapshot.
     */
    public state_get(): Partial<AppState> {
        return {
            currentStage: store.state.currentStage,
            selectedDatasets: [...store.state.selectedDatasets],
            activeProject: store.state.activeProject ? { ...store.state.activeProject } : null,
            marketplaceOpen: store.state.marketplaceOpen,
            installedAssets: [...store.state.installedAssets],
            costEstimate: { ...store.state.costEstimate },
            trainingJob: store.state.trainingJob ? { ...store.state.trainingJob } : null,
            lastIntent: store.state.lastIntent
        };
    }

    /**
     * Update partial store.state.
     */
    public state_set(newState: Partial<AppState>): void {
        store.state_patch(newState);
    }

    /**
     * Reset to initial store.state.
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
     * Get a dataset by its ID.
     */
    public dataset_getById(id: string): Dataset | undefined {
        return DATASETS.find(ds => ds.id === id);
    }

    /**
     * Get selected datasets.
     */
    public datasets_getSelected(): Dataset[] {
        return store.state.selectedDatasets;
    }

    /**
     * Get active project.
     */
    public project_getActive(): { id: string; name: string } | null {
        if (store.state.activeProject) {
            return {
                id: store.state.activeProject.id,
                name: store.state.activeProject.name
            };
        }
        return null;
    }

    /**
     * Get active project with complete metadata.
     */
    public project_getActiveFull(): Project | null {
        return store.state.activeProject ? { ...store.state.activeProject } : null;
    }

    /**
     * Set active project and synchronize selected datasets.
     */
    public project_setActive(project: Project): void {
        store.project_load(project);
    }

    /**
     * Set current stage.
     */
    public stage_set(stage: AppState['currentStage']): void {
        store.stage_set(stage);
    }

    /**
     * Get the current session path.
     */
    public session_getPath(): string | null {
        return this.sessionPath;
    }

    /**
     * Update the current session path.
     */
    public session_setPath(path: string | null): void {
        this.sessionPath = path;
    }

    /**
     * Get the current session ID.
     */
    public sessionId_get(): string | null {
        return store.sessionId_get();
    }

    /**
     * Start a new session.
     */
    public session_start(): void {
        store.session_start();
    }

    /**
     * Store recently mentioned datasets for anaphora resolution.
     */
    public lastMentioned_set(datasets: Dataset[]): void {
        store.lastMentioned_set(datasets);
    }

    /**
     * Retrieve recently mentioned datasets.
     */
    public lastMentioned_get(): Dataset[] {
        return store.lastMentioned_get();
    }
}

/**
 * Singleton instance of the store adapter.
 */
export const storeAdapter: StoreAdapter = new StoreAdapter();
