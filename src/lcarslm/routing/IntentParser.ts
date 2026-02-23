/**
 * @file Intent Parser
 *
 * Coordination layer for natural language interpretation. Delegating 
 * deterministic resolution to FastPathRouter and probabilistic 
 * resolution to LLMIntentCompiler.
 *
 * @module lcarslm/routing/IntentParser
 */

import type { CalypsoAction, CalypsoIntent, CalypsoStoreActions } from '../types.js';
import type { SearchProvider } from '../SearchProvider.js';
import { LCARSEngine } from '../engine.js';
import { FastPathRouter } from './FastPathRouter.js';
import { LLMIntentCompiler } from './LLMIntentCompiler.js';

export class IntentParser {
    private readonly fastPath: FastPathRouter;
    private readonly compiler: LLMIntentCompiler;

    constructor(
        private searchProvider: SearchProvider,
        private storeActions: CalypsoStoreActions,
        private workflowContext?: {
            activeStageId_get: () => string | null;
            stage_forCommand: (cmd: string) => { id: string; commands: string[] } | null;
            commands_list?: () => string[];
        }
    ) {
        this.fastPath = new FastPathRouter();
        this.compiler = new LLMIntentCompiler();
    }

    /**
     * Resolve raw natural language input to a canonical protocol intent.
     *
     * Every input is treated as a semantic compilation target. The LLM 
     * functions as the 'Compiler' that maps noisy human language to 
     * the deterministic protocol (workflow or shell).
     *
     * @param input - The user's raw input string.
     * @param model - Optional LLM model for interpretation.
     * @returns The resolved CalypsoIntent.
     */
    public async intent_resolve(input: string, model?: LCARSEngine | null): Promise<CalypsoIntent> {
        // v10.2: GROUNDED PRE-PROCESSING (Anaphora Resolution)
        const groundedInput = this.inputGrounded_resolve(input);

        // 1. FAST PATH: Check for exact deterministic matches first.
        const deterministic = this.fastPath.intent_resolve(groundedInput, {
            workflowCommands_resolve: () => this.workflowCommands_resolve(),
            workflowHandles_status: () => this.workflowHandles_status()
        });
        if (deterministic) {
            return deterministic;
        }

        // 2. PRIMARY PATH: Delegate to LLM for "Noisy-to-Protocol" compilation
        if (model) {
            return await this.compiler.compile(input, model, {
                workflowCommands_resolve: () => this.workflowCommands_resolve(),
                searchProvider: this.searchProvider,
                storeActions: this.storeActions
            });
        }

        // 3. FALLBACK: Return basic LLM intent for conversational input
        return {
            type: 'llm',
            raw: input,
            isModelResolved: false
        };
    }

    /**
     * Parse LLM response text and extract actions.
     */
    public actions_extractFromLLM(text: string): { actions: CalypsoAction[], cleanText: string } {
        return this.compiler.actions_extract(text, {
            workflowCommands_resolve: () => this.workflowCommands_resolve(),
            searchProvider: this.searchProvider,
            storeActions: this.storeActions
        });
    }

    /**
     * Resolve whether the current workflow context handles the 'status' command.
     */
    private workflowHandles_status(): boolean {
        if (!this.workflowContext) return false;
        const activeId = this.workflowContext.activeStageId_get();
        if (!activeId) return false;

        const stage = this.workflowContext.stage_forCommand('status');
        return stage?.id === activeId;
    }

    /**
     * Resolve active workflow command verbs from the runtime workflow context.
     */
    private workflowCommands_resolve(): string[] {
        if (!this.workflowContext?.commands_list) {
            return [];
        }

        const commandsRaw: string[] = this.workflowContext.commands_list();
        const commands: string[] = commandsRaw
            .map((cmd: string): string => cmd.trim().toLowerCase())
            // v10.4: Allow compound commands (e.g. "show container", "python train.py")
            .filter((cmd: string): boolean => cmd.length > 0);

        return Array.from(new Set(commands));
    }

    /**
     * Replace common anaphora/pronouns in the raw input string with concrete IDs.
     */
    private inputGrounded_resolve(input: string): string {
        const words = input.trim().split(/\s+/);
        if (words.length === 0) return input;

        // v10.2: Never ground the first word (it's the verb/command).
        const verb = words[0].toLowerCase();
        if (verb === 'rename') return input;

        const groundedWords = words.map((word, index) => {
            if (index === 0) return word;

            const normalized = word.toLowerCase().replace(/[^a-z0-9-]/g, '');
            const resolved = this.searchProvider.resolveAnaphora(normalized);
            if (resolved.length > 0) {
                return resolved.map(ds => ds.id).join(' ');
            }
            return word;
        });
        return groundedWords.join(' ');
    }
}
