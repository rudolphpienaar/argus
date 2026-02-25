/**
 * @file Session Bus Types
 *
 * Shared semantic types for the Session Bus layer.
 *
 * `WebSocketCalypso` is the kernel facade the bus wraps. It lives here
 * (not in WebSocketHandler) so SessionBus can import it without a
 * circular dependency.
 *
 * @module calypso/bus/types
 */

import type { CalypsoResponse, TelemetryEvent } from '../../lcarslm/types.js';
import type { WorkflowSummary } from '../../core/workflows/types.js';

// ─── Kernel Facade ───────────────────────────────────────────────────────────

/**
 * The kernel surface the Session Bus wraps.
 * Implemented by CalypsoCore; mirrored by SessionBus for passthroughs.
 */
export interface WebSocketCalypso {
    command_execute(command: string): Promise<CalypsoResponse>;
    boot(): Promise<void>;
    workflow_set(workflowId: string | null): Promise<boolean>;
    prompt_get(): string;
    tab_complete(line: string): string[];
    workflows_available(): WorkflowSummary[];
    telemetry_subscribe(observer: (event: TelemetryEvent) => void): () => void;
}

// ─── Session Event ───────────────────────────────────────────────────────────

/**
 * The semantic unit of cross-surface broadcast.
 *
 * Every intent submitted from any surface produces a SessionEvent that is
 * broadcast to all OTHER registered surfaces. The originator receives only
 * the direct response — not the event.
 *
 * `sourceId` is attribution metadata, not a routing key.
 */
export interface SessionEvent {
    /** Originating surface identifier: 'tui' | 'wui-<id>' | 'api' | 'ws-conn-<n>' */
    sourceId: string;
    /** The raw command string as submitted. */
    input: string;
    /** The kernel's full response — identical to what the originator received. */
    response: CalypsoResponse;
    /** Unix timestamp (ms) at which the intent was submitted. */
    timestamp: number;
}
