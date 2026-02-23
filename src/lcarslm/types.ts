/**
 * @file Types for LCARSLM
 *
 * Definitions for the LCARS Language Model interface and CalypsoCore.
 *
 * @module
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { Shell } from '../vfs/Shell.js';
import type { Dataset, AppState, Project } from '../core/models/types.js';
import type { FileNode } from '../vfs/types.js';
import type { SearchProvider } from './SearchProvider.js';
import type { SettingsService } from '../config/settings.js';

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
    /** Conversational prose wrap width in characters (CLI renderer hint). */
    convo_width?: number;
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

    /** v10.2: List of relative paths materialized by this plugin (e.g. '.cohort'). */
    materialized?: string[];

    /** Optional physical dataDir where plugin side-effects were materialized. */
    physicalDataDir?: string;

    /** v10.1 UI hints for explicit rendering control (animation, labels). */
    ui_hints?: ui_hints;
}

// ─── Telemetry Types ──────────────────────────────────────────────────────

/**
 * Contract phases for boot telemetry.
 */
export type BootPhase = 'login_boot' | 'workflow_boot';

/**
 * Contract statuses for boot telemetry.
 */
export type BootStatus = 'WAIT' | 'OK' | 'FAIL' | 'DONE';

/**
 * Structured boot milestone event.
 *
 * `phase` and `seq` are optional for backward compatibility with legacy
 * emitters/consumers during staged rollout.
 */
export interface BootLogEvent {
    type: 'boot_log';
    id: string;
    message: string;
    status: BootStatus | null;
    timestamp?: string;
    phase?: BootPhase;
    seq?: number;
}

/**
 * Primitives for live UI updates from plugins.
 * v10.2: Reactive primitives for line-by-line narrative control.
 */
export type TelemetryEvent =
    | { type: 'log'; message: string }
    | BootLogEvent
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

export type CommsPath = 'primary' | 'fallback';

export interface CommsPlan<T> {
    /** Preferred deterministic path. */
    primary: () => Promise<T> | T;
    /** Optional secondary path, launched in parallel with primary. */
    fallback?: () => Promise<T> | T;
    /** Predicate that decides whether the primary result is sufficient. */
    preferPrimary?: (value: T) => boolean;
}

export interface CommsResolution<T> {
    value: T;
    path: CommsPath;
    primaryValue?: T;
}

export interface DatasetSearchResolution {
    /** Final selected search results. */
    results: Dataset[];
    /** Path that produced the final results. */
    mode: 'lexical' | 'semantic';
}

export interface DatasetTargetResolution {
    /** Resolved datasets across all target tokens. */
    datasets: Dataset[];
    /** Inputs that could not be resolved by either path. */
    unresolved: string[];
    /** Whether any target required semantic fallback. */
    usedSemanticFallback: boolean;
}

/**
 * Shared plugin communication resolver exposed by the host.
 *
 * Owns primary/fallback policy so plugins call one entrypoint and do not
 * implement lexical/semantic branching directly.
 */
export interface PluginComms {
    execute<T>(primary: () => Promise<T> | T): Promise<T>;
    resolve<T>(plan: CommsPlan<T>): Promise<CommsResolution<T>>;
    datasetSearch_resolve(query: string): Promise<DatasetSearchResolution>;
    datasetTargets_resolve(targets: string[]): Promise<DatasetTargetResolution>;
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

    /** Access to dataset discovery and anaphora resolution. */
    search: SearchProvider;

    /** Shared primary/fallback communications resolver. */
    comms: PluginComms;

    /** Read/Write access to the centralized application store. */
    store: CalypsoStoreActions;

    /** v10.2 Live telemetry bus for streaming UI updates. */
    ui: PluginTelemetry;

    /** Configuration parameters provided in the Manifest YAML for this stage. */
    parameters: Record<string, unknown>;

    /** The canonical protocol command that triggered this plugin. */
    command: string;

    /** Arguments passed to the command. */
    args: string[];

    /** v10.2: Physical directory for this stage's payload materialization. */
    dataDir: string;
}

// ─── CalypsoCore Types ─────────────────────────────────────────────────────

/**
 * Serializable snapshot of VFS subtree for assertions.
 */
export interface VfsSnapshotNode {
    name: string;
    type: 'file' | 'folder' | 'link';
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
    /** Knowledge base content (filename -> content) */
    knowledge?: Record<string, string>;

    /** Optional LLM configuration. If omitted, AI conversational mode is offline. */
    llmConfig?: LCARSSystemConfig;

    /** Optional workflow ID to use. Falls back to runtime persona/workflow registry. */
    workflowId?: string;

    /** Optional project name for session path grounding. */
    projectName?: string;

    /** v12.0: Optional external telemetry bus for capturing genesis events. */
    telemetryBus?: any;

    /** Optional shared settings manager (user-scoped). */
    settingsService?: SettingsService;
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

    /** v11.0: Get current session ID */
    sessionId_get(): string | null;

    /** v11.0: Generate a new session ID */
    session_start(): void;

    /** v10.2: Store recently mentioned datasets for anaphora resolution across turns. */
    lastMentioned_set(datasets: Dataset[]): void;
    /** v10.2: Retrieve recently mentioned datasets. */
    lastMentioned_get(): Dataset[];
}
