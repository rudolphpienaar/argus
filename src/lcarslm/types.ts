/**
 * @file Types for LCARSLM
 *
 * Definitions for the LCARS Language Model interface and CalypsoCore.
 *
 * @module
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { Shell } from '../vfs/Shell.js';
import type { Dataset, AppState, FederationState, Project } from '../core/models/types.js';
import type { FileNode } from '../vfs/types.js';
import type { FederationOrchestrator } from './federation/FederationOrchestrator.js';

// ─── LLM Types ─────────────────────────────────────────────────────────────

/**
 * Represents a single message in a chat conversation.
 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Represents the response from the LCARSLM engine.
 */
export interface QueryResponse {
    answer: string;
    relevantDatasets: Dataset[];
}

/**
 * Configuration options for the LCARSLM system.
 */
export interface LCARSSystemConfig {
    apiKey: string;
    model: string;
    provider: 'openai' | 'gemini';
}

// ─── Calypso Status & Results ───────────────────────────────────────────

/**
 * Protocol-level status codes for Calypso interactions.
 *
 * Used by Oracle tests to verify the deterministic logic state machine
 * independently of natural language output.
 */
export enum CalypsoStatusCode {
    /** Intent matched, prerequisites met, execution succeeded. */
    OK = 'OK',

    /** Intent matched, but blocked by workflow constraints (generic). */
    BLOCKED = 'BLOCKED',

    /** Intent matched, but blocked by workflow constraints (e.g. missing parent). */
    BLOCKED_MISSING = 'BLOCKED_MISSING',

    /** Intent matched, but blocked by stale fingerprints (needs re-execution). */
    BLOCKED_STALE = 'BLOCKED_STALE',

    /** Input resolved to a conversational intent (chat/fallback). */
    CONVERSATIONAL = 'CONVERSATIONAL',

    /** Intent matched, but a technical error occurred during execution. */
    ERROR = 'ERROR',

    /** Input could not be resolved to any meaningful intent. */
    UNKNOWN = 'UNKNOWN'
}

/** Configuration for complex step animations (e.g. harmonization lattice). */
export interface StepAnimationConfig {
    type: 'harmonization' | 'training';
    duration_ms: number;
    steps: string[];
}

/** v10.1 UI hints for explicit rendering control (animation, labels). */
export interface ui_hints {
    spinner_label?: string;
    render_mode?: 'plain' | 'streaming' | 'training';
    stream_delay_ms?: number;
    animation?: 'progress_box' | 'harmonization' | 'none';
    animation_config?: StepAnimationConfig;
}

/**
 * Result returned by an atomic workflow plugin.
 *
 * This is the contract between the Plugin (Guest) and the Calypso Host.
 * The Host interprets the statusCode and message, while wrapping any
 * artifactData into the Merkle session tree.
 */
export interface PluginResult {
    /** Protocol-agnostic feedback for the user. */
    message: string;

    /** Categorical status code for the execution result. */
    statusCode: CalypsoStatusCode;

    /** Optional UI actions to be dispatched by the host. */
    actions?: CalypsoAction[];

    /** Optional domain-specific payload for the Merkle artifact envelope. */
    artifactData?: unknown;

    /** v10.1 UI hints for explicit rendering control (animation, labels). */
    ui_hints?: ui_hints;
}

// ─── Telemetry Types ──────────────────────────────────────────────────────

/**
 * Primitives for live UI updates from plugins.
 * v10.2: Reactive primitives for line-by-line narrative control.
 */
export type TelemetryEvent =
    | { type: 'log'; message: string }
    | { type: 'progress'; label: string; percent: number }
    | { type: 'frame_open'; title: string; subtitle?: string }
    | { type: 'frame_close'; summary?: string[] }
    | { type: 'phase_start'; name: string }
    | { type: 'status'; message: string };

/**
 * Live telemetry bus provided to Guest plugins.
 */
export interface PluginTelemetry {
    /** Emit a log line to the client terminal. */
    log(message: string): void;
    /** Start or update a progress tracker. */
    progress(label: string, percent: number): void;
    /** Open an animated UI frame (e.g. btop-style box). */
    frame_open(title: string, subtitle?: string): void;
    /** Close the current UI frame and display summary. */
    frame_close(summary?: string[]): void;
    /** Mark the beginning of a new sub-phase within a frame. */
    phase_start(name: string): void;
    /** Update the status line. */
    status(message: string): void;
}

/**
 * Standard context injected into every plugin.
 *
 * Provides the "Standard Library" for plugins to interact with the Argus VM.
 * Plugins use this to mutate the project tree and read application state.
 */
export interface PluginContext {
    /** Access to the Virtual File System (Project Tree). */
    vfs: VirtualFileSystem;

    /** Ability to execute Shell builtins and scripts. */
    shell: Shell;

    /** Read/Write access to the centralized application store. */
    store: CalypsoStoreActions;

    /** Access to the stateful federation handshake orchestrator. */
    federation: FederationOrchestrator;

    /** v10.2 Live telemetry bus for streaming UI updates. */
    ui: PluginTelemetry;

    /** Utility to sleep for N milliseconds (simulating compute). */
    sleep(ms: number): Promise<void>;

    /** Configuration parameters provided in the Manifest YAML for this stage. */
    parameters: Record<string, unknown>;

    /** The canonical protocol command that triggered this plugin. */
    command: string;

    /** Arguments passed to the command. */
    args: string[];
}

// ─── CalypsoCore Types ─────────────────────────────────────────────────────

/**
 * Serializable snapshot of VFS subtree for assertions.
 */
export interface VfsSnapshotNode {
    name: string;
    type: 'file' | 'folder';
    path: string;
    size?: string;
    content?: string;
    hasGenerator?: boolean;
    children?: VfsSnapshotNode[];
}

/**
 * Actions that CalypsoCore can request an adapter to perform.
 * These are UI/environment-specific operations delegated to adapters.
 */
export type CalypsoAction =
    | { type: 'dataset_select'; id: string }
    | { type: 'dataset_open'; id: string }
    | { type: 'dataset_deselect'; id: string }
    | { type: 'project_create'; name: string }
    | { type: 'project_open'; id: string }
    | { type: 'project_rename'; id: string; newName: string }
    | { type: 'stage_advance'; stage: AppState['currentStage']; workflow?: string }
    | { type: 'workspace_render'; datasets: Dataset[] }
    | { type: 'overlay_close' }
    | { type: 'federation_start' }
    | { type: 'marketplace_open' }
    | { type: 'marketplace_close' };

/**
 * Response from CalypsoCore command execution.
 * Contains a message to display and optional actions for adapters.
 */
export interface CalypsoResponse {
    /** Text message to display to the user */
    message: string;

    /** Actions for the adapter to execute (environment-specific) */
    actions: CalypsoAction[];

    /** Whether the command executed successfully (Legacy: Use statusCode for logic) */
    success: boolean;

    /** Categorical status code for protocol verification and Oracle testing. */
    statusCode: CalypsoStatusCode;

    /** v10.1 UI hints for explicit rendering control (animation, labels). */
    ui_hints?: ui_hints;

    /** Optional state snapshots for testing/debugging */
    state?: {
        vfs?: VfsSnapshotNode;
        store?: Partial<AppState>;
    };
}

/**
 * Classified intent from natural language input.
 *
 * This is the "compiled" form of a user's request.
 */
export interface CalypsoIntent {
    /** The broad category of intent. */
    type: 'shell' | 'workflow' | 'llm' | 'special';

    /** The canonical command name (e.g., 'rename', 'harmonize'). */
    command?: string;

    /** Arguments for the command. */
    args?: string[];

    /** The original user input string. */
    raw: string;

    /** Whether the intent was resolved via LLM (true) or deterministic logic (false). */
    isModelResolved: boolean;
}

/**
 * Configuration for CalypsoCore initialization.
 */
export interface CalypsoCoreConfig {
    /** Enable simulation mode (no real LLM calls) */
    simulationMode?: boolean;

    /** Knowledge base content (filename -> content) */
    knowledge?: Record<string, string>;

    /** LLM configuration (required if not in simulation mode) */
    llmConfig?: LCARSSystemConfig;

    /** Workflow ID to use (default: 'fedml') */
    workflowId?: string;

    /** Runtime materialization mode (default: 'store'). */
    runtimeMaterialization?: 'legacy' | 'store';

    /** Enable runtime join-node writes (default: true). */
    runtimeJoinMaterialization?: boolean;
}

// ─── Store Actions Interface ───────────────────────────────────────────────

/**
 * Interface for store actions that CalypsoCore needs.
 * This avoids circular dependencies with the full Store class.
 */
export interface CalypsoStoreActions {
    /** Get current state snapshot */
    state_get(): Partial<AppState>;

    /** Update partial state */
    state_set(state: Partial<AppState>): void;

    /** Reset to initial state */
    reset(): void;

    /** Select a dataset */
    dataset_select(dataset: Dataset): void;

    /** Deselect a dataset by ID */
    dataset_deselect(id: string): void;

    /** Get a dataset by its ID */
    dataset_getById(id: string): Dataset | undefined;

    /** Get selected datasets */
    datasets_getSelected(): Dataset[];

    /** Get active project */
    project_getActive(): { id: string; name: string } | null;

    /** Get full active project record */
    project_getActiveFull(): Project | null;

    /** Set active project and synchronize store-selected datasets */
    project_setActive(project: Project): void;

    /** Set current stage */
    stage_set(stage: AppState['currentStage']): void;

    /** Get the current session path */
    session_getPath(): string | null;

    /** Update the current session path */
    session_setPath(path: string | null): void;

    /** Get current federation handshake state */
    federation_getState(): FederationState | null;

    /** Update federation handshake state */
    federation_setState(state: FederationState | null): void;

    /** v10.2: Store recently mentioned datasets for anaphora resolution across turns. */
    lastMentioned_set(datasets: Dataset[]): void;
    /** v10.2: Retrieve recently mentioned datasets. */
    lastMentioned_get(): Dataset[];
}
