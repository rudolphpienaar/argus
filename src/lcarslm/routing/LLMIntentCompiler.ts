/**
 * @file LLM Intent Compiler
 *
 * Probabilistic mapping of natural language to strictly-typed JSON protocols.
 * Handles prompt construction, JSON extraction, and anaphora resolution.
 *
 * @module lcarslm/routing/LLMIntentCompiler
 */

import type { CalypsoIntent, CalypsoAction, CalypsoStoreActions } from '../types.js';
import type { LCARSEngine } from '../engine.js';
import type { SearchProvider } from '../SearchProvider.js';
import type { Dataset } from '../../core/models/types.js';

interface ModelIntentPayload {
    type?: unknown;
    command?: unknown;
    args?: unknown;
}

/**
 * Context required for LLM intent compilation.
 */
export interface LLMCompilerContext {
    workflowCommands_resolve: () => string[];
    searchProvider: SearchProvider;
    storeActions: CalypsoStoreActions;
}

/**
 * Compiler for semantic natural-language-to-protocol translation.
 */
export class LLMIntentCompiler {
    /**
     * Compile natural language into a structured intent using the LLM.
     *
     * @param input - Original user input.
     * @param model - The LLM engine.
     * @param ctx - Compiler context.
     * @returns Compiled intent.
     */
    public async compile(
        input: string, 
        model: LCARSEngine, 
        ctx: LLMCompilerContext
    ): Promise<CalypsoIntent> {
        const workflowCommands: string[] = ctx.workflowCommands_resolve();
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
            return this.intent_fromModelPayload(input, payload, ctx);
        } catch {
            return this.intent_modelFallback(input);
        }
    }

    /**
     * Parse side effects from a conversational response.
     */
    public actions_extract(text: string, ctx: LLMCompilerContext): { actions: CalypsoAction[], cleanText: string } {
        const actions: CalypsoAction[] = [];

        // 1. Update search context
        ctx.searchProvider.context_updateFromText(text);

        // 2. Extract Individual Actions
        this.datasetSelection_extract(text, actions);
        this.workflowAdvance_extract(text, actions);
        this.datasetRender_extract(text, ctx.searchProvider, actions);
        this.projectRename_extract(text, ctx.storeActions, actions);

        // 3. Clean up text markers
        const cleanText: string = this.actionMarkers_strip(text);

        return { actions, cleanText };
    }

    private datasetSelection_extract(text: string, actions: CalypsoAction[]): void {
        const matches: RegExpMatchArray[] = Array.from(text.matchAll(/\[SELECT: (ds-[0-9]+)\]/g));
        for (const match of matches) {
            actions.push({ type: 'dataset_select', id: match[1] });
        }
    }

    private workflowAdvance_extract(text: string, actions: CalypsoAction[]): void {
        const match: RegExpMatchArray | null = text.match(/\[ACTION: PROCEED(?:\s+([a-z0-9_-]+))?\]/i);
        if (match) {
            actions.push({
                type: 'stage_advance',
                stage: 'process',
                workflow: match[1]?.toLowerCase()
            });
        }
    }

    private datasetRender_extract(text: string, search: SearchProvider, actions: CalypsoAction[]): void {
        if (!text.includes('[ACTION: SHOW_DATASETS]')) return;

        let datasets: Dataset[] = [...search.lastMentioned_get()];
        const filterMatch: RegExpMatchArray | null = text.match(/\[FILTER: (.*?)\]/);
        
        if (filterMatch) {
            const ids: string[] = filterMatch[1].split(',').map(s => s.trim());
            datasets = datasets.filter(ds => ids.includes(ds.id));
        }
        actions.push({ type: 'workspace_render', datasets });
    }

    private projectRename_extract(text: string, store: CalypsoStoreActions, actions: CalypsoAction[]): void {
        const match: RegExpMatchArray | null = text.match(/\[ACTION: RENAME (.*?)\]/);
        if (match) {
            const active = store.project_getActive();
            if (active) {
                actions.push({ type: 'project_rename', id: active.id, newName: match[1].trim() });
            }
        }
    }

    private actionMarkers_strip(text: string): string {
        return text
            .replace(/\[SELECT: ds-[0-9]+\]/g, '')
            .replace(/\[ACTION: PROCEED(?:\s+[a-z0-9_-]+)?\]/gi, '')
            .replace(/\[ACTION: SHOW_DATASETS\]/g, '')
            .replace(/\[FILTER:.*?\]/g, '')
            .replace(/\[ACTION: RENAME.*?\]/g, '')
            .trim();
    }

    private payload_parseFromModelText(text: string): ModelIntentPayload | null {
        const jsonMatch: RegExpMatchArray | null = text.match(/\{.*?\}/s);
        if (!jsonMatch || !jsonMatch[0]) return null;

        try {
            const parsed = JSON.parse(jsonMatch[0]);
            return (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) 
                ? (parsed as ModelIntentPayload) 
                : null;
        } catch {
            return null;
        }
    }

    private intent_fromModelPayload(input: string, payload: ModelIntentPayload, ctx: LLMCompilerContext): CalypsoIntent {
        const typeValue = payload.type;
        const type: CalypsoIntent['type'] = (typeValue === 'workflow' || typeValue === 'llm' || typeValue === 'shell' || typeValue === 'special') 
            ? typeValue as CalypsoIntent['type'] 
            : 'llm';

        if (type !== 'workflow') return this.intent_modelFallback(input);

        const command: string | undefined = typeof payload.command === 'string' && payload.command.length > 0 ? payload.command : undefined;
        const workflowCommands: Set<string> = new Set<string>(ctx.workflowCommands_resolve());
        
        if (!command || !workflowCommands.has(command)) return this.intent_modelFallback(input);

        const rawArgs: string[] = Array.isArray(payload.args) 
            ? payload.args.filter((entry): entry is string => typeof entry === 'string') 
            : [];
        
        // Selective resolution for mutation verbs
        const resolutionVerbs = ['add', 'remove', 'deselect', 'gather', 'review', 'rename'];
        const resolvedArgs: string[] = resolutionVerbs.includes(command) 
            ? this.modelArgs_resolve(rawArgs, ctx.searchProvider)
            : rawArgs;

        return { type: 'workflow', command, args: resolvedArgs, raw: input, isModelResolved: true };
    }

    private modelArgs_resolve(args: string[], search: SearchProvider): string[] {
        const resolved: string[] = [];
        for (const arg of args) {
            const resolvedDatasets = search.resolve(arg);
            if (resolvedDatasets.length > 0) {
                resolved.push(...resolvedDatasets.map(ds => ds.id));
            } else {
                resolved.push(arg);
            }
        }
        return resolved;
    }

    private intent_modelFallback(input: string): CalypsoIntent {
        return { type: 'llm', raw: input, isModelResolved: true };
    }
}
