/**
 * @file Intent Parser
 *
 * Compiles natural language input into deterministic protocol intents.
 * Also extracts side effects from LLM conversational responses.
 *
 * @module lcarslm/routing/IntentParser
 */

import type { CalypsoAction, CalypsoIntent, CalypsoStoreActions } from '../types.js';
import type { SearchProvider } from '../SearchProvider.js';
import type { Dataset } from '../../core/models/types.js';
import { LCARSEngine } from '../engine.js';

interface ModelIntentPayload {
    type?: unknown;
    command?: unknown;
    args?: unknown;
}

const MODEL_WORKFLOW_COMMANDS: ReadonlySet<string> = new Set<string>([
    'search', 'add', 'gather', 'harmonize', 'federate', 'dispatch', 'status', 'publish', 'proceed', 'rename'
]);

export class IntentParser {
    constructor(
        private searchProvider: SearchProvider,
        private storeActions: CalypsoStoreActions
    ) {}

    /**
     * Resolve raw natural language input to a canonical protocol intent.
     *
     * In full agentic mode, this delegates to the LLM. In simulation or
     * legacy mode, it uses deterministic regex matching.
     *
     * @param input - The user's raw input string.
     * @param model - Optional LLM model for interpretation.
     * @returns The resolved CalypsoIntent.
     */
    public async intent_resolve(input: string, model?: LCARSEngine | null): Promise<CalypsoIntent> {
        // 1. Check for deterministic protocol match first (1970s mode)
        const deterministic: CalypsoIntent | null = this.deterministicIntent_resolve(input);
        if (deterministic) {
            return deterministic;
        }

        // 2. If no model, we are stuck with the deterministic match (which failed)
        if (!model) {
            return {
                type: 'llm', // Fallback to chat if unrecognized
                raw: input,
                isModelResolved: false
            };
        }

        // 3. Delegate to LLM for "Noisy-to-Protocol" compilation
        return await this.modelIntent_resolve(input, model);
    }

    /**
     * Deterministic regex-based intent resolution (1970s mode).
     *
     * @param input - Raw input string.
     * @returns Resolved intent or null if no match.
     */
    private deterministicIntent_resolve(input: string): CalypsoIntent | null {
        const trimmed: string = input.trim().toLowerCase();
        
        // Match 'rename [to] <name>'
        const renameMatch: RegExpMatchArray | null = trimmed.match(/^rename\s+(?:to\s+)?(.+)$/);
        if (renameMatch) {
            return {
                type: 'workflow',
                command: 'rename',
                args: [renameMatch[1].trim()],
                raw: input,
                isModelResolved: false
            };
        }

        // Match exact workflow verbs
        const workflowVerbs: string[] = [
            'search', 'add', 'remove', 'deselect', 'gather', 'review', 'mount', 
            'rename', 'harmonize', 'proceed', 'code', 'train', 'python', 
            'federate', 'approve', 'show', 'config', 'dispatch', 'status', 'publish'
        ];
        const firstWord: string = trimmed.split(/\s+/)[0];
        if (workflowVerbs.includes(firstWord)) {
            const args: string[] = trimmed.split(/\s+/).slice(1);
            return {
                type: 'workflow',
                command: firstWord,
                args: args,
                raw: input,
                isModelResolved: false
            };
        }

        return null;
    }

    /**
     * Use the LLM to compile natural language into a structured intent.
     *
     * @param input - Raw natural language.
     * @param model - The LLM engine.
     * @returns Compiled intent.
     */
    private async modelIntent_resolve(input: string, model: LCARSEngine): Promise<CalypsoIntent> {
        const prompt: string = `
            You are the ARGUS Intent Compiler. Your job is to translate noisy natural language
            into a strictly-typed JSON intent object for the ARGUS Operating System.

            AVAILABLE COMMANDS: search, add, gather, harmonize, federate, dispatch, status, publish, proceed, rename.

            FORMAT:
            { "type": "workflow" | "llm", "command": string, "args": string[] }

            EXAMPLES:
            "rename this to histo-exp please" -> { "type": "workflow", "command": "rename", "args": ["histo-exp"] }
            "what's the weather?" -> { "type": "llm" }

            USER INPUT: "${input}"
        `;

        try {
            const response = await model.query(prompt);
            const payload: ModelIntentPayload | null = this.payload_parseFromModelText(response.answer);
            if (!payload) {
                return this.intent_modelFallback(input);
            }
            return this.intent_fromModelPayload(input, payload);
        } catch {
            return this.intent_modelFallback(input);
        }
    }

    /**
     * Parse LLM response text and extract actions.
     * Side effects:
     * - Updates search context from text
     * - Executes deterministic mutations (rename, harmonize) for headless VFS
     */
    public actions_extractFromLLM(text: string): { actions: CalypsoAction[], cleanText: string } {
        const actions: CalypsoAction[] = [];

        // 1. Update conversation context (side effect)
        this.searchProvider.context_updateFromText(text);

        // 2. Extract Individual Actions
        this.datasetSelection_extract(text, actions);
        this.workflowAdvance_extract(text, actions);
        this.datasetRender_extract(text, actions);
        this.projectRename_extract(text, actions);
        this.harmonization_extract(text, actions);

        // 3. Clean up text markers
        const cleanText: string = this.actionMarkers_strip(text);

        return { actions, cleanText };
    }

    /** Extract [SELECT: ds-xxx] dataset selection intents. */
    private datasetSelection_extract(text: string, actions: CalypsoAction[]): void {
        const matches: RegExpMatchArray[] = Array.from(text.matchAll(/\[SELECT: (ds-[0-9]+)\]/g));
        for (const match of matches) {
            actions.push({ type: 'dataset_select', id: match[1] });
        }
    }

    /** Extract [ACTION: PROCEED] workflow advance intents. */
    private workflowAdvance_extract(text: string, actions: CalypsoAction[]): void {
        const match: RegExpMatchArray | null = text.match(/\[ACTION: PROCEED(?:\s+(fedml|chris))?\]/i);
        if (match) {
            actions.push({
                type: 'stage_advance',
                stage: 'process',
                workflow: this.workflow_parseFromProceedMatch(match)
            });
        }
    }

    /** Extract [ACTION: SHOW_DATASETS] and [FILTER: ...] render intents. */
    private datasetRender_extract(text: string, actions: CalypsoAction[]): void {
        if (!text.includes('[ACTION: SHOW_DATASETS]')) return;

        let datasets: Dataset[] = [...this.searchProvider.lastMentioned_get()];
        const filterMatch: RegExpMatchArray | null = text.match(/\[FILTER: (.*?)\]/);
        
        if (filterMatch) {
            const ids: string[] = filterMatch[1].split(',').map(s => s.trim());
            datasets = datasets.filter(ds => ids.includes(ds.id));
        }
        actions.push({ type: 'workspace_render', datasets });
    }

    /** Extract [ACTION: RENAME xxx] project rename intents. */
    private projectRename_extract(text: string, actions: CalypsoAction[]): void {
        const match: RegExpMatchArray | null = text.match(/\[ACTION: RENAME (.*?)\]/);
        if (match) {
            const active = this.storeActions.project_getActive();
            if (active) {
                actions.push({ type: 'project_rename', id: active.id, newName: match[1].trim() });
            }
        }
    }

    /** Extract [ACTION: HARMONIZE] intents. */
    private harmonization_extract(text: string, actions: CalypsoAction[]): void {
        if (text.includes('[ACTION: HARMONIZE]')) {
            // Future: resolve to workflow intent
        }
    }

    /** Strip all [ACTION: ...] and control markers from conversational text. */
    private actionMarkers_strip(text: string): string {
        return text
            .replace(/\[SELECT: ds-[0-9]+\]/g, '')
            .replace(/\[ACTION: PROCEED(?:\s+(?:fedml|chris))?\]/gi, '')
            .replace(/\[ACTION: SHOW_DATASETS\]/g, '')
            .replace(/\[FILTER:.*?\]/g, '')
            .replace(/\[ACTION: RENAME.*?\]/g, '')
            .replace(/\[ACTION: HARMONIZE\]/g, '')
            .trim();
    }

    /**
     * Parse model text and extract the first JSON object payload.
     *
     * @param text - Raw model output text.
     * @returns Parsed payload or null when parsing fails.
     */
    private payload_parseFromModelText(text: string): ModelIntentPayload | null {
        const jsonMatch: RegExpMatchArray | null = text.match(/\{.*?\}/s);
        if (!jsonMatch || !jsonMatch[0]) {
            return null;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(jsonMatch[0]);
        } catch {
            return null;
        }

        if (!this.value_isRecord(parsed)) {
            return null;
        }
        return parsed as ModelIntentPayload;
    }

    /**
     * Convert parsed model payload into a validated Calypso intent.
     *
     * @param input - Original user input.
     * @param payload - Parsed model payload.
     * @returns Validated compiled intent.
     */
    private intent_fromModelPayload(input: string, payload: ModelIntentPayload): CalypsoIntent {
        const type: CalypsoIntent['type'] = this.intentType_fromUnknown(payload.type);
        if (type !== 'workflow') {
            return this.intent_modelFallback(input);
        }

        const command: string | undefined = this.command_fromUnknown(payload.command);
        if (!command || !MODEL_WORKFLOW_COMMANDS.has(command)) {
            return this.intent_modelFallback(input);
        }

        const args: string[] | undefined = this.args_fromUnknown(payload.args);
        return {
            type: 'workflow',
            command,
            args,
            raw: input,
            isModelResolved: true
        };
    }

    /**
     * Build model-resolved conversational fallback intent.
     *
     * @param input - Original user input.
     * @returns Fallback LLM intent.
     */
    private intent_modelFallback(input: string): CalypsoIntent {
        return { type: 'llm', raw: input, isModelResolved: true };
    }

    /**
     * Resolve a Calypso intent type from unknown model payload value.
     *
     * @param value - Unknown payload value.
     * @returns Validated intent type.
     */
    private intentType_fromUnknown(value: unknown): CalypsoIntent['type'] {
        if (value === 'workflow' || value === 'llm' || value === 'shell' || value === 'special') {
            return value;
        }
        return 'llm';
    }

    /**
     * Resolve workflow command from unknown payload value.
     *
     * @param value - Unknown payload value.
     * @returns Command string if valid.
     */
    private command_fromUnknown(value: unknown): string | undefined {
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    }

    /**
     * Resolve argument list from unknown payload value.
     *
     * @param value - Unknown payload value.
     * @returns String arguments if valid.
     */
    private args_fromUnknown(value: unknown): string[] | undefined {
        if (!Array.isArray(value)) {
            return undefined;
        }
        return value.filter((entry: unknown): entry is string => typeof entry === 'string');
    }

    /**
     * Runtime object guard for unknown parsed JSON.
     *
     * @param value - Unknown value.
     * @returns True if value is a plain record.
     */
    private value_isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    /**
     * Parse optional workflow marker from proceed action match.
     *
     * @param match - Proceed regex match.
     * @returns Workflow identifier when present.
     */
    private workflow_parseFromProceedMatch(match: RegExpMatchArray): string | undefined {
        const workflowRaw: string | undefined = match[1];
        return workflowRaw ? workflowRaw.toLowerCase() : undefined;
    }
}
