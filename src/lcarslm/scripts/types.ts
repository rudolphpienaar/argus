/**
 * @file Script Runtime Types
 *
 * Type definitions for the structured script execution engine.
 *
 * @module
 */

import type { CalypsoAction } from '../types.js';
import type { CalypsoScript, CalypsoStructuredScript } from './Catalog.js';

export interface ScriptRuntimeContext {
    defaults: Record<string, string>;
    answers: Record<string, string>;
    outputs: Record<string, unknown>;
}

export interface ScriptPendingInput {
    kind: 'param' | 'selection';
    key: string;
    prompt: string;
    options?: string[];
}

export interface ScriptRuntimeSession {
    script: CalypsoScript;
    spec: CalypsoStructuredScript;
    stepIndex: number;
    context: ScriptRuntimeContext;
    actions: CalypsoAction[];
    pending: ScriptPendingInput | null;
}

export interface ScriptStepParamsResolved {
    ok: true;
    params: Record<string, unknown>;
}

export interface ScriptStepParamsPending {
    ok: false;
    pending: ScriptPendingInput;
    params: Record<string, unknown>;
}

export type ScriptStepParamResolution = ScriptStepParamsResolved | ScriptStepParamsPending;

export interface ScriptValueResolved {
    ok: true;
    value: unknown;
}

export interface ScriptValuePending {
    ok: false;
    pending: ScriptPendingInput;
    value: undefined;
}

export type ScriptValueResolution = ScriptValueResolved | ScriptValuePending;

export interface ScriptStepExecutionSuccess {
    success: true;
    output?: unknown;
    actions: CalypsoAction[];
    summary?: string;
}

export interface ScriptStepExecutionFailure {
    success: false;
    actions: CalypsoAction[];
    message?: string;
}

export interface ScriptStepExecutionPending {
    success: 'pending';
    pending: ScriptPendingInput;
    actions: CalypsoAction[];
}

export type ScriptStepExecutionResult =
    ScriptStepExecutionSuccess
    | ScriptStepExecutionFailure
    | ScriptStepExecutionPending;

export interface ScriptSuggestionScore {
    id: string;
    score: number;
}
