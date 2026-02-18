/**
 * @file Core type definitions for ARGUS
 *
 * Defines the fundamental data structures used throughout the ARGUS application,
 * including datasets, training jobs, and node status representations.
 *
 * @module
 */

/**
 * Represents a dataset available in the ATLAS catalog.
 */
export interface Dataset {
    id: string;
    name: string;
    description: string;
    modality: 'xray' | 'ct' | 'mri' | 'pathology';
    annotationType: 'segmentation' | 'classification' | 'detection';
    imageCount: number;
    size: string;
    cost: number;
    provider: string;
    thumbnail: string;
}

/**
 * Represents a file or folder in the virtual filesystem.
 */
export interface FileNode {
    name: string;
    type: 'folder' | 'file' | 'image';
    path: string;
    children?: FileNode[];
    size?: string;
}

/**
 * Represents a Trusted Domain node participating in federated training.
 */
export interface TrustedDomainNode {
    id: string;
    name: string;
    institution: string;
    status: 'initializing' | 'active' | 'waiting' | 'complete' | 'error';
    progress: number;
    samplesProcessed: number;
    totalSamples: number;
}

/**
 * Represents a training job's current state.
 */
export interface TrainingJob {
    id: string;
    status: 'pending' | 'running' | 'complete' | 'aborted' | 'error';
    currentEpoch: number;
    totalEpochs: number;
    loss: number;
    accuracy: number;
    auc: number;
    runningCost: number;
    budgetLimit: number;
    startTime: Date;
    nodes: TrustedDomainNode[];
    lossHistory: number[];
}

/**
 * Represents a saved developer project/cohort.
 */
export interface Project {
    id: string;
    name: string;
    description: string;
    created: Date;
    lastModified: Date;
    datasets: Dataset[];
}

/**
 * Represents cost breakdown for a training job.
 */
export interface CostEstimate {
    dataAccess: number;
    compute: number;
    storage: number;
    total: number;
}

/**
 * Federation visibility levels.
 */
export type FederationVisibility = 'public' | 'private';

/**
 * Federation step IDs — aligned 1:1 with fedml.manifest.yaml stage IDs.
 */
export type FederationStep =
    | 'federate-brief'
    | 'federate-transcompile'
    | 'federate-containerize'
    | 'federate-publish-config'
    | 'federate-publish-execute'
    | 'federate-dispatch'
    | 'federate-execute'
    | 'federate-model-publish';

/**
 * Publication metadata for federated models.
 */
export interface FederationPublishConfig {
    appName: string | null;
    org: string | null;
    visibility: FederationVisibility;
}

/**
 * Handshake state for the multi-phase federation protocol.
 */
export interface FederationState {
    projectId: string;
    step: FederationStep;
    publish: FederationPublishConfig;
}

/**
 * Application state for the SeaGaP-MP workflow.
 */
export interface AppState {
    currentStage: 'login' | 'role-selection' | 'search' | 'gather' | 'process' | 'monitor' | 'post';
    selectedDatasets: Dataset[];
    activeProject: Project | null;
    virtualFilesystem: FileNode | null;
    costEstimate: CostEstimate;
    trainingJob: TrainingJob | null;
    marketplaceOpen: boolean;
    installedAssets: string[];
    lastIntent: string | null;
    federationState: FederationState | null;
}
