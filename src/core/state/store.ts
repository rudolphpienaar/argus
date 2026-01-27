/**
 * @file Application State
 * 
 * Centralized state management for the ARGUS application.
 * 
 * @module
 */

import type { AppState, Project, Dataset, TrustedDomainNode } from '../models/types.js';

type Persona = 'developer' | 'annotator' | 'user' | 'provider' | 'scientist' | 'clinician' | 'admin' | 'fda';

export const state: AppState & { currentPersona: Persona } = {
    currentPersona: 'developer',
    currentStage: 'login',
    selectedDatasets: [],
    activeProject: null,
    virtualFilesystem: null,
    costEstimate: { dataAccess: 0, compute: 0, storage: 0, total: 0 },
    trainingJob: null
};

// Global References (to be populated by modules)
export const globals = {
    terminal: null as any, // Typed in usage
    lcarsEngine: null as any,
    trainingInterval: null as number | null,
    lossChart: null as { ctx: CanvasRenderingContext2D; data: number[] } | null
};
