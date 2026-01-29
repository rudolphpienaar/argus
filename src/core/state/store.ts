/**
 * @file Application Store
 *
 * Centralized State Management using Pub/Sub pattern.
 * Holds the Single Source of Truth and dispatches events on mutation.
 *
 * @module
 */

import type { AppState, Project, Dataset, CostEstimate, TrainingJob } from '../models/types.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { events, Events } from './events.js';
import { MARKETPLACE_ASSETS, type MarketplaceAsset } from '../data/marketplace.js';
import { asset_install } from '../../vfs/providers/MarketplaceProvider.js';
import type { LCARSTerminal } from '../../ui/components/Terminal.js';
import type { LCARSEngine } from '../../lcarslm/engine.js';
import type { Shell } from '../../vfs/Shell.js';
import type { FrameSlot } from '../../ui/components/FrameSlot.js';

type Persona = 'fedml' | 'appdev' | 'annotator' | 'user' | 'provider' | 'scientist' | 'clinician' | 'admin' | 'fda';

interface ExtendedState extends AppState {
    currentPersona: Persona;
    marketplaceOpen: boolean;
    installedAssets: string[];
}

/** Initial application state with all defaults zeroed. */
const initialState: ExtendedState = {
    currentPersona: 'fedml',
    currentStage: 'login',
    selectedDatasets: [],
    activeProject: null,
    virtualFilesystem: null,
    costEstimate: { dataAccess: 0, compute: 0, storage: 0, total: 0 },
    trainingJob: null,
    marketplaceOpen: false,
    installedAssets: []
};

/**
 * Centralized application store.
 * Manages all mutable state and emits events on mutation via the EventBus.
 */
class Store {
    private _state: ExtendedState;

    /** Global singletons shared across modules. */
    public globals: {
        terminal: LCARSTerminal | null;
        lcarsEngine: LCARSEngine | null;
        vcs: VirtualFileSystem;
        shell: Shell | null;
        trainingInterval: number | null;
        lossChart: { ctx: CanvasRenderingContext2D; data: number[] } | null;
        frameSlot: FrameSlot | null;
    } = {
        terminal: null,
        lcarsEngine: null,
        vcs: new VirtualFileSystem(),
        shell: null,
        trainingInterval: null,
        lossChart: null,
        frameSlot: null
    };

    constructor() {
        this._state = { ...initialState };
    }

    /**
     * Provides read-only access to the application state.
     *
     * @returns The current extended application state.
     */
    get state(): ExtendedState {
        return this._state;
    }

    // ─── Actions ────────────────────────────────────────────────

    /**
     * Transitions the application to a new SeaGaP stage.
     *
     * @param stage - The target stage name.
     */
    public stage_set(stage: AppState['currentStage']): void {
        if (this._state.currentStage === stage) return;
        this._state.currentStage = stage;
        events.emit(Events.STAGE_CHANGED, stage);
        events.emit(Events.STATE_CHANGED, this._state);
    }

    /**
     * Toggles the marketplace overlay open or closed.
     *
     * @param open - If provided, forces the marketplace to this state.
     */
    public marketplace_toggle(open?: boolean): void {
        this._state.marketplaceOpen = open !== undefined ? open : !this._state.marketplaceOpen;
        events.emit(Events.STATE_CHANGED, this._state);
    }

    /**
     * Installs a marketplace asset by ID.
     * Delegates VFS population to the MarketplaceProvider.
     *
     * @param assetId - The marketplace asset identifier.
     */
    public asset_install(assetId: string): void {
        if (!this._state.installedAssets.includes(assetId)) {
            this._state.installedAssets.push(assetId);
            const asset: MarketplaceAsset | undefined = MARKETPLACE_ASSETS.find(
                (a: MarketplaceAsset): boolean => a.id === assetId
            );

            if (asset) {
                asset_install(this.globals.vcs, asset);
            }

            events.emit(Events.STATE_CHANGED, this._state);
        }
    }

    /**
     * Sets the active user persona.
     *
     * @param persona - The persona to activate.
     */
    public persona_set(persona: Persona): void {
        this._state.currentPersona = persona;
        events.emit(Events.STATE_CHANGED, this._state);
    }

    /**
     * Toggles a dataset's selection state.
     * If selected, deselects it; if unselected, selects it.
     *
     * @param dataset - The dataset to toggle.
     */
    public dataset_toggle(dataset: Dataset): void {
        const index: number = this._state.selectedDatasets.findIndex(
            (ds: Dataset): boolean => ds.id === dataset.id
        );
        if (index >= 0) {
            this._state.selectedDatasets.splice(index, 1);
        } else {
            this._state.selectedDatasets.push(dataset);
        }
        events.emit(Events.DATASET_SELECTION_CHANGED, this._state.selectedDatasets);
        events.emit(Events.STATE_CHANGED, this._state);
    }

    /**
     * Selects a dataset (no-op if already selected).
     *
     * @param dataset - The dataset to select.
     */
    public dataset_select(dataset: Dataset): void {
        if (!this._state.selectedDatasets.some((ds: Dataset): boolean => ds.id === dataset.id)) {
            this._state.selectedDatasets.push(dataset);
            events.emit(Events.DATASET_SELECTION_CHANGED, this._state.selectedDatasets);
            events.emit(Events.STATE_CHANGED, this._state);
        }
    }

    /**
     * Deselects a dataset by ID.
     *
     * @param datasetId - The ID of the dataset to deselect.
     */
    public dataset_deselect(datasetId: string): void {
        const index: number = this._state.selectedDatasets.findIndex(
            (ds: Dataset): boolean => ds.id === datasetId
        );
        if (index >= 0) {
            this._state.selectedDatasets.splice(index, 1);
            events.emit(Events.DATASET_SELECTION_CHANGED, this._state.selectedDatasets);
            events.emit(Events.STATE_CHANGED, this._state);
        }
    }

    /**
     * Clears all dataset selections.
     */
    public selection_clear(): void {
        if (this._state.selectedDatasets.length > 0) {
            this._state.selectedDatasets = [];
            events.emit(Events.DATASET_SELECTION_CHANGED, []);
            events.emit(Events.STATE_CHANGED, this._state);
        }
    }

    /**
     * Loads a project, setting it as active and populating datasets.
     *
     * @param project - The project to load.
     */
    public project_load(project: Project): void {
        this._state.activeProject = project;
        this._state.selectedDatasets = [...project.datasets];

        events.emit(Events.PROJECT_LOADED, project);
        events.emit(Events.DATASET_SELECTION_CHANGED, this._state.selectedDatasets);
        events.emit(Events.STATE_CHANGED, this._state);
    }

    /**
     * Unloads the active project and clears dataset selections.
     */
    public project_unload(): void {
        this._state.activeProject = null;
        this._state.selectedDatasets = [];
        events.emit(Events.PROJECT_LOADED, null);
        events.emit(Events.DATASET_SELECTION_CHANGED, []);
        events.emit(Events.STATE_CHANGED, this._state);
    }

    /**
     * Updates the cost estimate.
     *
     * @param estimate - The new cost breakdown.
     */
    public cost_update(estimate: CostEstimate): void {
        this._state.costEstimate = estimate;
        events.emit(Events.STATE_CHANGED, this._state);
    }

    /**
     * Sets or clears the active training job.
     *
     * @param job - The training job, or null to clear.
     */
    public trainingJob_set(job: TrainingJob | null): void {
        this._state.trainingJob = job;
        events.emit(Events.STATE_CHANGED, this._state);
    }

    /**
     * Partially updates the active training job.
     *
     * @param updates - Fields to merge into the current job.
     */
    public trainingJob_update(updates: Partial<TrainingJob>): void {
        if (this._state.trainingJob) {
            this._state.trainingJob = { ...this._state.trainingJob, ...updates };
            events.emit(Events.STATE_CHANGED, this._state);
        }
    }
}

export const store: Store = new Store();
/** Backward compatibility export for direct state access. */
export const state: ExtendedState = store.state;
/** Backward compatibility export for global singletons. */
export const globals: Store['globals'] = store.globals;
