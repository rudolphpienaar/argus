/**
 * @file Intent Parser
 *
 * Coordination layer for natural language interpretation. Enforces the 
 * "Precedence of Truth" by ensuring deterministic resolution (FastPath) 
 * always precedes probabilistic resolution (LLM).
 *
 * Incorporates the IntentGuard to jail LLM vocabulary and validate output.
 *
 * @module lcarslm/routing/IntentParser
 */

import type { CalypsoAction, CalypsoIntent, CalypsoStoreActions } from '../types.js';
import type { SearchProvider } from '../SearchProvider.js';
import { LCARSEngine } from './LCARSEngine.js';
import { FastPathRouter } from './FastPathRouter.js';
import { LLMIntentCompiler } from './LLMIntentCompiler.js';
import { IntentGuard } from './IntentGuard.js';

export interface IntentParserContext {
    activeStageId_get: () => string | null;
    stage_forCommand: (cmd: string) => { id: string; commands: string[] } | null;
    commands_list: () => string[];
    systemCommands_list: () => string[];
    readyCommands_list: () => string[];
    workflow_nextStep?: () => string;
}

export class IntentParser {
    private readonly fastPath: FastPathRouter;
    private readonly compiler: LLMIntentCompiler;

    constructor(
        private readonly searchProvider: SearchProvider,
        private readonly storeActions: CalypsoStoreActions,
        private readonly guard: IntentGuard,
        private readonly workflowContext: IntentParserContext,
        private readonly options: { bypassAnaphora?: boolean } = {}
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
        // v12.0: Bypassed in NULL_HYPOTHESIS mode
        const groundedInput = this.options.bypassAnaphora ? input : this.inputGrounded_resolve(input);

        // 1. FAST PATH: Check for exact deterministic matches first.
        // This is the Interceptor Pattern: deterministic truth ALWAYS precedes probability.
        const deterministic = this.fastPath.intent_resolve(groundedInput, {
            workflowCommands_resolve: () => this.workflowCommands_resolve(),
            systemCommands_list: () => this.workflowContext.systemCommands_list(),
            workflowHandles_status: () => this.workflowHandles_status()
        });
        if (deterministic) {
            return deterministic;
        }

        // 2. PRIMARY PATH: Delegate to LLM for "Noisy-to-Protocol" compilation
        if (model) {
            return await this.probabilisticIntent_resolve(input, model);
        }

        // 3. FALLBACK: Return basic LLM intent for conversational input
        return {
            type: 'llm',
            raw: input,
            isModelResolved: false
        };
    }

    /**
     * Perform probabilistic resolution using the LLM and the IntentGuard.
     */
    private async probabilisticIntent_resolve(input: string, model: LCARSEngine): Promise<CalypsoIntent> {
        const allCommands = this.workflowCommands_resolve();
        const readyCommands = this.workflowContext.readyCommands_list();

        // v11.0: Vocabulary Jail
        // We filter the commands presented to the model based on DAG readiness.
        const jailedVocabulary = this.guard.vocabulary_jail(allCommands, readyCommands);

        const intent = await this.compiler.compile(input, model, {
            workflowCommands_resolve: () => jailedVocabulary,
            searchProvider: this.searchProvider,
            storeActions: this.storeActions
        });

        // v11.0: Output Validation
        // We intercept the model's decision and verify it against the ready set.
        return this.guard.intent_validate(intent, readyCommands);
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
        const activeId = this.workflowContext.activeStageId_get();
        if (!activeId) return false;

        const stage = this.workflowContext.stage_forCommand('status');
        return stage?.id === activeId;
    }

    /**
     * Resolve active workflow command verbs from the runtime workflow context.
     */
    private workflowCommands_resolve(): string[] {
        const commandsRaw: string[] = this.workflowContext.commands_list();
        const commands: string[] = commandsRaw
            .map((cmd: string): string => cmd.trim().toLowerCase())
            .filter((cmd: string): boolean => cmd.length > 0);

        return Array.from(new Set(commands));
    }

    /**
     * Replace common anaphora/pronouns in the raw input string with concrete IDs.
     */
    private inputGrounded_resolve(input: string): string {
        const words = input.trim().split(/\s+/);
        if (words.length === 0) return input;

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
