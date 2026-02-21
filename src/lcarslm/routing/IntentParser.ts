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

export class IntentParser {
    constructor(
        private searchProvider: SearchProvider,
        private storeActions: CalypsoStoreActions,
        private workflowContext?: {
            activeStageId_get: () => string | null;
            stage_forCommand: (cmd: string) => { id: string; commands: string[] } | null;
            commands_list?: () => string[];
        }
    ) {}

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
        // Before matching, ground common pronouns ('this', 'it') into the input string
        // using the Host's persistent dataset memory.
        const groundedInput = this.inputGrounded_resolve(input);

        // 1. FAST PATH: Check for exact deterministic matches first.
        const deterministic = this.deterministicIntent_resolve(groundedInput);
        if (deterministic) {
            return deterministic;
        }

        // 2. PRIMARY PATH: Delegate to LLM for \"Noisy-to-Protocol\" compilation
        if (model) {
            return await this.modelIntent_resolve(input, model);
        }

        // 3. FALLBACK: Return basic LLM intent for conversational input
        return {
            type: 'llm',
            raw: input,
            isModelResolved: false
        };
    }

    /**
     * Deterministic regex-based intent resolution (1970s mode).
     *
     * @param input - Raw input string.
     * @returns Resolved intent or null if no match.
     */
    private deterministicIntent_resolve(input: string): CalypsoIntent | null {
        const trimmed: string = input.trim().toLowerCase();
        
        // Match 'rename [this] [to] <name>'
        const renameMatch: RegExpMatchArray | null = trimmed.match(/^rename\s+(?:this\s+)?(?:(?:to|as)\s+)?(.+)$/);
        if (renameMatch) {
            return {
                type: 'workflow',
                command: 'rename',
                args: [renameMatch[1].trim()],
                raw: input,
                isModelResolved: false
            };
        }

        // Match 'proceed [workflow]'
        const proceedMatch: RegExpMatchArray | null = trimmed.match(/^proceed(?:\s+(.+))?$/);
        if (proceedMatch) {
            return {
                type: 'workflow',
                command: 'proceed',
                args: proceedMatch[1] ? [proceedMatch[1].trim()] : [],
                raw: input,
                isModelResolved: false
            };
        }

        // Match 'status' or '/status'
        if (trimmed === '/status' || (trimmed === 'status' && !this.workflowHandles_status())) {
            return {
                type: 'special',
                command: 'status',
                args: [],
                raw: input,
                isModelResolved: false
            };
        }

        // Match exact workflow verbs
        const workflowVerbs: string[] = this.workflowCommands_resolve();
        const firstWord: string = trimmed.split(/\s+/)[0];
        if (workflowVerbs.includes(firstWord)) {
            let args: string[] = trimmed.split(/\s+/).slice(1);
            
            // Special case for 'search for X' -> arg is X
            if (firstWord === 'search' && args.length > 0 && args[0] === 'for') {
                args = args.slice(1);
            } else if (args.length > 0 && (args[0] === 'the' || args[0] === 'a')) {
                // v10.1: Strip leading prepositions/filler from arguments (e.g. 'add the X')
                args = args.slice(1);
            }

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
        const workflowCommands: string[] = this.workflowCommands_resolve();
        const workflowLine: string = workflowCommands.length > 0
            ? workflowCommands.join(', ')
            : '(none)';
        const prompt: string = `
            You are the ARGUS Intent Compiler. Your job is to translate noisy natural language
            into a strictly-typed JSON intent object for the ARGUS Operating System.

            AVAILABLE COMMANDS: 
            - Workflow: ${workflowLine}.
            - Shell: ls, cd, cat, mkdir, pwd, touch, rm, cp, mv, tree.

            FORMAT:
            { "type": "workflow" | "shell" | "llm", "command": string, "args": string[] }

            RULES:
            1. If the input is a command request, map it to the most relevant command.
            2. For "search for [topic]", command is "search" and args is ["[topic]"].
            3. For "list all [extension] files", command is "ls" and args is ["*.[extension]"].
            4. If the input is conversational (greeting, question, etc.), set type to "llm".

            EXAMPLES:
            "Search for histology data" -> { "type": "workflow", "command": "search", "args": ["histology"] }
            "list all text files" -> { "type": "shell", "command": "ls", "args": ["*.txt"] }
            "rename this to project-x" -> { "type": "workflow", "command": "rename", "args": ["project-x"] }
            "hello calypso" -> { "type": "llm" }

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
        const match: RegExpMatchArray | null = text.match(/\[ACTION: PROCEED(?:\s+([a-z0-9_-]+))?\]/i);
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

    /** Strip all [ACTION: ...] and control markers from conversational text. */
    private actionMarkers_strip(text: string): string {
        return text
            .replace(/\[SELECT: ds-[0-9]+\]/g, '')
            .replace(/\[ACTION: PROCEED(?:\s+[a-z0-9_-]+)?\]/gi, '')
            .replace(/\[ACTION: SHOW_DATASETS\]/g, '')
            .replace(/\[FILTER:.*?\]/g, '')
            .replace(/\[ACTION: RENAME.*?\]/g, '')
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
        const workflowCommands: Set<string> = new Set<string>(this.workflowCommands_resolve());
        if (!command || workflowCommands.size === 0 || !workflowCommands.has(command)) {
            return this.intent_modelFallback(input);
        }

        const rawArgs: string[] | undefined = this.args_fromUnknown(payload.args);
        
        // v10.2: Selective resolution. 
        // We only resolve anaphora/pronouns for assembly/mutation verbs.
        // SEARCH queries must remain fuzzy/noisy for the provider to handle.
        const resolutionVerbs = ['add', 'remove', 'deselect', 'gather', 'review', 'rename'];
        const resolvedArgs: string[] = resolutionVerbs.includes(command) 
            ? this.modelArgs_resolve(rawArgs || [])
            : (rawArgs || []);

        return {
            type: 'workflow',
            command,
            args: resolvedArgs,
            raw: input,
            isModelResolved: true
        };
    }

    /**
     * Resolve ambiguous model arguments (anaphora) into concrete protocol identifiers.
     * 
     * This is the 'Compiler' phase that grounds human-centric pronouns ('this', 'it', 'them')
     * into machine-centric identifiers (ds-001) using the Host's persistent memory.
     *
     * @param args - Raw arguments from LLM.
     * @returns Resolved concrete arguments.
     */
    private modelArgs_resolve(args: string[]): string[] {
        const resolved: string[] = [];

        for (const arg of args) {
            const resolvedDatasets = this.searchProvider.resolve(arg);
            if (resolvedDatasets.length > 0) {
                // If it resolves to datasets, push their IDs instead of the raw arg
                resolved.push(...resolvedDatasets.map(ds => ds.id));
            } else {
                // Otherwise keep the arg as-is (e.g. search terms, project names)
                resolved.push(arg);
            }
        }

        return resolved;
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
            .filter((cmd: string): boolean => /^[a-z][a-z0-9_-]*$/.test(cmd));

        return Array.from(new Set(commands));
    }

    /**
     * Replace common anaphora/pronouns in the raw input string with concrete IDs.
     */
    private inputGrounded_resolve(input: string): string {
        const words = input.trim().split(/\s+/);
        if (words.length === 0) return input;

        // v10.2: Never ground the first word (it's the verb/command).
        // Also skip grounding for 'rename' as it uses raw text for names.
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
