/**
 * @file LLM Intent Compiler
 *
 * Probabilistic translation of noisy natural language into strictly-typed JSON intents.
 * This is the "Higher Brain" component of the CNS.
 *
 * @module lcarslm/kernel/LLMIntentCompiler
 */

import type { CalypsoIntent, CalypsoAction, CalypsoStoreActions } from '../types.js';
import type { LCARSEngine } from './LCARSEngine.js';
import type { SearchProvider } from '../SearchProvider.js';
import type { Dataset } from '../../core/models/types.js';

/**
 * Context required for intent compilation.
 */
export interface LLMCompilerContext {
    workflowCommands_resolve: () => string[];
    storeActions: CalypsoStoreActions;
    searchProvider: SearchProvider;
}

/**
 * Probabilistic compiler for noisy user inputs.
 */
export class LLMIntentCompiler {
    /**
     * Compile natural language input into a structured intent.
     * 
     * @param input - Grounded user input.
     * @param model - The underlying language model.
     * @param ctx - Compiler context (vocab + state).
     * @returns Resolved intent.
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
            
        // v12.0: Strict Anaphora Context
        // We only tell the compiler about datasets mentioned in the last turn
        // to prevent over-eager selection of the entire catalog.
        const recentDatasets = ctx.storeActions.lastMentioned_get();
        const datasetLine = recentDatasets.length > 0
            ? recentDatasets.map(d => `${d.id} (${d.name})`).join(', ')
            : '(none mentioned in last turn)';

        const prompt: string = `
            You are the ARGUS Intent Compiler. Your job is to translate noisy natural language
            into a strictly-typed JSON intent object for the ARGUS Operating System.

            AVAILABLE COMMANDS: 
            - Workflow: ${workflowLine}.
            - Shell: ls, cd, cat, mkdir, pwd, touch, rm, cp, mv, tree.

            RECENTLY MENTIONED DATASETS (for anaphora like "it", "them", "those"):
            ${datasetLine}

            FORMAT:
            { "type": "workflow" | "shell" | "llm", "command": string, "args": string[] }

            RULES:
            1. If the input is a command request, map it to the most relevant command.
            2. For "list all [extension] files", command is "ls" and args is ["*.[extension]"].
            3. If the input is conversational (greeting, question, etc.), set type to "llm".
        `;

        try {
            const result = await model.query(prompt + `\n\nINPUT: "${input}"`, [], true);
            const jsonStr = this.json_extract(result.answer);
            const intent = JSON.parse(jsonStr) as CalypsoIntent;

            const validTypes = ['workflow', 'shell', 'llm'];
            if (!intent.type || !validTypes.includes(intent.type)) {
                return { type: 'llm', raw: input, isModelResolved: true };
            }

            // Validate that a workflow command is actually in the allowed vocabulary
            if (intent.type === 'workflow') {
                const allowedCommands = ctx.workflowCommands_resolve();
                if (!intent.command || !allowedCommands.includes(intent.command)) {
                    return { type: 'llm', raw: input, isModelResolved: true };
                }
            }

            // Post-process anaphora resolution for dataset IDs
            intent.args = await this.anaphora_resolve(intent.args || [], ctx);

            return {
                ...intent,
                raw: input,
                isModelResolved: true
            };
        } catch {
            return {
                type: 'llm',
                raw: input,
                isModelResolved: true
            };
        }
    }

    /**
     * Extract structured actions and clean text from LLM response.
     */
    public actions_extract(text: string, ctx: any): { actions: CalypsoAction[], cleanText: string } {
        const actions: CalypsoAction[] = [];
        let cleanText = text;

        // 1. SELECT tags
        const selectMatches = Array.from(text.matchAll(/\[SELECT: (ds-[0-9]+)\]/g));
        for (const match of selectMatches) {
            actions.push({ type: 'dataset_select', id: match[1] });
            cleanText = cleanText.replace(match[0], '');
        }

        // 2. SHOW_DATASETS → workspace_render
        const showDatasetsMatch = text.match(/\[ACTION: SHOW_DATASETS\]/i);
        if (showDatasetsMatch) {
            const selected = ctx.storeActions?.datasets_getSelected?.() ?? [];
            actions.push({ type: 'workspace_render', datasets: selected });
            cleanText = cleanText.replace(showDatasetsMatch[0], '');
        }

        return { actions, cleanText: cleanText.trim() };
    }

    /**
     * Resolve pronouns like "those" or "them" into actual dataset IDs.
     */
    private async anaphora_resolve(args: string[], ctx: LLMCompilerContext): Promise<string[]> {
        const resolutionTokens = ['it', 'them', 'those', 'this', 'that', 'all'];
        const needsResolution = args.some(a => resolutionTokens.includes(a.toLowerCase()));
        
        if (!needsResolution) {
            return args;
        }

        const recentDatasets = ctx.storeActions.lastMentioned_get();
        if (recentDatasets.length === 0) {
            return args;
        }

        const resolved: string[] = [];
        for (const arg of args) {
            if (resolutionTokens.includes(arg.toLowerCase())) {
                resolved.push(...recentDatasets.map(ds => ds.id));
            } else {
                // If it's a dataset ID but not recently mentioned, verify it exists
                const resolvedDatasets = ctx.searchProvider.resolve(arg);
                if (resolvedDatasets.length > 0) {
                    resolved.push(...resolvedDatasets.map(ds => ds.id));
                } else {
                    resolved.push(arg);
                }
            }
        }

        return Array.from(new Set(resolved));
    }

    /**
     * Extract JSON block from markdown-wrapped model response.
     */
    private json_extract(text: string): string {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) return '{}';
        return text.substring(start, end + 1);
    }
}
