/**
 * @file Types for LCARSLM
 *
 * Definitions for the LCARS Language Model interface and CalypsoCore.
 *
 * @module
 */

import type { Dataset, AppState } from '../core/models/types.js';
import type { FileNode } from '../vfs/types.js';

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
    | { type: 'stage_advance'; stage: AppState['currentStage']; workflow?: 'fedml' | 'chris' }
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

    /** Whether the command executed successfully */
    success: boolean;

    /** Optional state snapshots for testing/debugging */
    state?: {
        vfs?: VfsSnapshotNode;
        store?: Partial<AppState>;
    };
}

/**
 * Classified intent from natural language input.
 */
export interface CalypsoIntent {
    type: 'shell' | 'workflow' | 'llm' | 'special';
    command?: string;
    args?: string[];
    raw: string;
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
}
