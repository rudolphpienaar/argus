/**
 * @file Application Store
 * 
 * Centralized State Management using Pub/Sub pattern.
 * Holds the Single Source of Truth and dispatches events on mutation.
 * 
 * @module
 */

import type { AppState, Project, Dataset, TrustedDomainNode, TrainingJob } from '../models/types.js';
import { VirtualFileSystem } from '../logic/vfs.js';
import { events, Events } from './events.js';
import { MARKETPLACE_ASSETS, type MarketplaceAsset } from '../data/marketplace.js';

type Persona = 'developer' | 'annotator' | 'user' | 'provider' | 'scientist' | 'clinician' | 'admin' | 'fda';

interface ExtendedState extends AppState {
    currentPersona: Persona;
    marketplaceOpen: boolean;
    installedAssets: string[];
}

// Initial State
const initialState: ExtendedState = {
    currentPersona: 'developer',
    currentStage: 'login',
    selectedDatasets: [],
    activeProject: null,
    virtualFilesystem: null,
    costEstimate: { dataAccess: 0, compute: 0, storage: 0, total: 0 },
    trainingJob: null,
    marketplaceOpen: false,
    installedAssets: []
};

class Store {
    private _state: ExtendedState;
    // ...
    public globals = {
        terminal: null as any,
        lcarsEngine: null as any,
        vfs: new VirtualFileSystem(),
        trainingInterval: null as number | null,
        lossChart: null as { ctx: CanvasRenderingContext2D; data: number[] } | null
    };

    constructor() {
        this._state = { ...initialState };
    }

    // Read-only access to state
    get state() {
        return this._state;
    }

    // --- Actions ---

    public setStage(stage: AppState['currentStage']) {
        if (this._state.currentStage === stage) return;
        this._state.currentStage = stage;
        events.emit(Events.STAGE_CHANGED, stage);
        events.emit(Events.STATE_CHANGED, this._state);
    }

    public toggleMarketplace(open?: boolean) {
        console.log('DEBUG: Store.toggleMarketplace called. Current:', this._state.marketplaceOpen, 'Target:', open);
        this._state.marketplaceOpen = open !== undefined ? open : !this._state.marketplaceOpen;
        events.emit(Events.STATE_CHANGED, this._state);
    }

    public installAsset(assetId: string) {
        if (!this._state.installedAssets.includes(assetId)) {
            this._state.installedAssets.push(assetId);
            const asset = MARKETPLACE_ASSETS.find(a => a.id === assetId);
            
            // Re-mount binaries to VFS if it's a plugin
            if (asset && asset.type === 'plugin') {
                this.globals.vfs.touch(`/home/developer/bin/${asset.name}`);
            }

            events.emit(Events.STATE_CHANGED, this._state);
        }
    }

    public setPersona(persona: Persona) {
        this._state.currentPersona = persona;
        events.emit(Events.STATE_CHANGED, this._state);
    }

    public toggleDataset(dataset: Dataset) {
        const index = this._state.selectedDatasets.findIndex(ds => ds.id === dataset.id);
        if (index >= 0) {
            this._state.selectedDatasets.splice(index, 1);
        } else {
            this._state.selectedDatasets.push(dataset);
        }
        events.emit(Events.DATASET_SELECTION_CHANGED, this._state.selectedDatasets);
        events.emit(Events.STATE_CHANGED, this._state);
    }

    public selectDataset(dataset: Dataset) {
        if (!this._state.selectedDatasets.some(ds => ds.id === dataset.id)) {
            this._state.selectedDatasets.push(dataset);
            events.emit(Events.DATASET_SELECTION_CHANGED, this._state.selectedDatasets);
            events.emit(Events.STATE_CHANGED, this._state);
        }
    }

    public deselectDataset(datasetId: string) {
        const index = this._state.selectedDatasets.findIndex(ds => ds.id === datasetId);
        if (index >= 0) {
            this._state.selectedDatasets.splice(index, 1);
            events.emit(Events.DATASET_SELECTION_CHANGED, this._state.selectedDatasets);
            events.emit(Events.STATE_CHANGED, this._state);
        }
    }

    public clearSelection() {
        if (this._state.selectedDatasets.length > 0) {
            this._state.selectedDatasets = [];
            events.emit(Events.DATASET_SELECTION_CHANGED, []);
            events.emit(Events.STATE_CHANGED, this._state);
        }
    }

    public loadProject(project: Project) {
        this._state.activeProject = project;
        this._state.selectedDatasets = [...project.datasets];
        
        // Implicitly update VFS
        // (Note: In a pure store, we might just emit PROJECT_LOADED and let vfs listen,
        // but since vfs is in globals, we can do it here or let listeners handle it.
        // For purity, we emit.)
        
        events.emit(Events.PROJECT_LOADED, project);
        events.emit(Events.DATASET_SELECTION_CHANGED, this._state.selectedDatasets);
        events.emit(Events.STATE_CHANGED, this._state);
    }

    public unloadProject() {
        this._state.activeProject = null;
        this._state.selectedDatasets = [];
        events.emit(Events.PROJECT_LOADED, null);
        events.emit(Events.DATASET_SELECTION_CHANGED, []);
        events.emit(Events.STATE_CHANGED, this._state);
    }

    public updateCost(estimate: any) {
        this._state.costEstimate = estimate;
        events.emit(Events.STATE_CHANGED, this._state);
    }

    public setTrainingJob(job: TrainingJob | null) {
        this._state.trainingJob = job;
        events.emit(Events.STATE_CHANGED, this._state);
    }

    public updateTrainingJob(updates: Partial<TrainingJob>) {
        if (this._state.trainingJob) {
            this._state.trainingJob = { ...this._state.trainingJob, ...updates };
            events.emit(Events.STATE_CHANGED, this._state);
        }
    }
}

export const store = new Store();
// Backward compatibility exports for easier refactoring
export const state = store.state;
export const globals = store.globals;