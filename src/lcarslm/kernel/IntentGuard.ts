/**
 * @file Intent Guard
 *
 * Fundamental security and integrity module for intent resolution.
 * Controls the "Vocabulary Jail" for the LLM and validates output 
 * against the current DAG readiness state.
 *
 * This module is toggleable to allow for quantitative drift experiments.
 *
 * @module lcarslm/routing/IntentGuard
 */

import { CalypsoStatusCode, type CalypsoIntent } from '../../types.js';

/**
 * Operational mode for the Intent Guard.
 */
export enum IntentGuardMode {
    /** 
     * Enforce strict DAG-ready vocabulary and validate LLM output. 
     * Hallucination-prevention active.
     */
    STRICT = 'strict',

    /** 
     * Pass-through mode for measuring model drift and instruction decay. 
     * Guardrails inactive.
     */
    EXPERIMENTAL = 'experimental'
}

/**
 * Configuration for the IntentGuard.
 */
export interface IntentGuardConfig {
    mode: IntentGuardMode;
}

/**
 * Security middleware for anchoring probabilistic intents in deterministic truth.
 */
export class IntentGuard {
    private readonly mode: IntentGuardMode;

    constructor(config: IntentGuardConfig) {
        this.mode = config.mode;
    }

    /**
     * Filter the manifest vocabulary to include only currently ready commands.
     * 
     * In STRICT mode, this prevents the LLM from even knowing about 
     * commands for stages that aren't yet satisfied.
     * 
     * @param allCommands - The full set of commands declared in the manifest.
     * @param readyCommands - The subset of commands eligible for execution.
     * @returns The vocabulary to be injected into the LLM prompt.
     */
    public vocabulary_jail(allCommands: string[], readyCommands: string[]): string[] {
        if (this.mode === IntentGuardMode.EXPERIMENTAL) {
            return allCommands;
        }

        // v11.0: Vocabulary Jail
        // We only allow the model to see the commands it is allowed to execute.
        // This stops the model from "stealing" intents for future stages.
        return readyCommands;
    }

    /**
     * Validate a resolved intent against the active DAG readiness.
     * 
     * In STRICT mode, if the LLM attempts to return a workflow command 
     * that isn't in the ready set, it is downgraded to conversational.
     * 
     * @param intent - The intent returned by the LLM Intent Compiler.
     * @param readyCommands - The subset of commands currently eligible.
     * @returns The validated (and potentially downgraded) intent.
     */
    public intent_validate(intent: CalypsoIntent, readyCommands: string[]): CalypsoIntent {
        if (this.mode === IntentGuardMode.EXPERIMENTAL) {
            return intent;
        }

        // Only validate workflow-type intents
        if (intent.type !== 'workflow' || !intent.command) {
            return intent;
        }

        const isReady = readyCommands.includes(intent.command);
        if (isReady) {
            return intent;
        }

        // v11.0: Intent Interception
        // The LLM attempted to execute a command that isn't ready. 
        // We downgrade this to 'llm' (conversational) so the DAG engine 
        // doesn't have to handle an illegal out-of-order execution.
        return {
            ...intent,
            type: 'llm',
            command: undefined,
            args: undefined,
            // Tag it as intercepted for telemetry/testing
            isIntercepted: true 
        } as any;
    }

    /**
     * Get the current operational mode.
     */
    public mode_get(): IntentGuardMode {
        return this.mode;
    }
}
