/**
 * @file Calypso WebSocket Protocol Types
 *
 * Typed bidirectional message definitions for the WebSocket transport
 * between CalypsoServer and CalypsoClient (TUI/WUI).
 *
 * Every request carries a correlation `id` so the client can match
 * responses to pending promises even when messages arrive out of order.
 *
 * @module
 */

import type { CalypsoResponse, TelemetryEvent } from '../../lcarslm/types.js';
import type { WorkflowSummary } from '../../core/workflows/types.js';

// ─── Client → Server ────────────────────────────────────────────────────────

export interface CommandMessage {
    type: 'command';
    id: string;
    command: string;
}

export interface LoginMessage {
    type: 'login';
    id: string;
    username: string;
}

export interface PersonaMessage {
    type: 'persona';
    id: string;
    workflowId: string | null;
}

export interface PromptRequestMessage {
    type: 'prompt';
    id: string;
}

export interface TabCompleteMessage {
    type: 'tab-complete';
    id: string;
    line: string;
    cursor: number;
}

export type ClientMessage =
    | CommandMessage
    | LoginMessage
    | PersonaMessage
    | PromptRequestMessage
    | TabCompleteMessage;

// ─── Server → Client ────────────────────────────────────────────────────────

export interface ResponseMessage {
    type: 'response';
    id: string;
    payload: CalypsoResponse;
}

export interface TelemetryMessage {
    type: 'telemetry';
    payload: TelemetryEvent;
}

export interface LoginResponseMessage {
    type: 'login-response';
    id: string;
    success: boolean;
    username: string;
    workflows: WorkflowSummary[];
    message?: string;
}

export interface PersonaResponseMessage {
    type: 'persona-response';
    id: string;
    success: boolean;
    message: string;
}

export interface PromptResponseMessage {
    type: 'prompt-response';
    id: string;
    prompt: string;
}

export interface TabCompleteResponseMessage {
    type: 'tab-complete-response';
    id: string;
    completions: string[];
    partial: string;
}

export interface ErrorMessage {
    type: 'error';
    id: string;
    message: string;
}

/**
 * Cross-surface broadcast message.
 *
 * Sent to every surface that did NOT originate the intent. Contains the
 * full CalypsoResponse so each secondary surface can run its complete
 * rendering pipeline — identical to what the originator received.
 *
 * `sourceId` is attribution metadata; surfaces render all events the same way.
 */
export interface SessionEventMessage {
    type: 'session_event';
    sourceId: string;
    input: string;
    response: CalypsoResponse;
    timestamp: number;
}

export type ServerMessage =
    | ResponseMessage
    | TelemetryMessage
    | SessionEventMessage
    | LoginResponseMessage
    | PersonaResponseMessage
    | PromptResponseMessage
    | TabCompleteResponseMessage
    | ErrorMessage;

// ─── Helpers ────────────────────────────────────────────────────────────────

let counter = 0;

/**
 * Generate a unique correlation ID for a message.
 */
export function messageId_generate(): string {
    return `msg-${Date.now()}-${++counter}`;
}
