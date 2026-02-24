/**
 * @file FastPath Router
 *
 * Deterministic intent resolution using regex patterns and exact manifest 
 * phrase matching. Handles high-frequency commands without LLM latency.
 *
 * @module lcarslm/routing/FastPathRouter
 */

import type { CalypsoIntent } from '../../types.js';

/**
 * Context required for deterministic intent resolution.
 */
export interface FastPathContext {
    workflowCommands_resolve: () => string[];
    systemCommands_list: () => string[];
    workflowHandles_status: () => boolean;
}

/**
 * Router for high-speed deterministic command resolution.
 */
export class FastPathRouter {
    /**
     * Resolve raw input string into a deterministic intent.
     *
     * @param input - Grounded user input.
     * @param ctx - Router context.
     * @returns Resolved intent or null if no deterministic match found.
     */
    public intent_resolve(input: string, ctx: FastPathContext): CalypsoIntent | null {
        const trimmed: string = input.trim();
        const trimmedLower: string = trimmed.toLowerCase();
        
        // 1. Rename 'rename [this] [to] <name>'
        const renameMatch: RegExpMatchArray | null = trimmedLower.match(/^rename\s+(?:this\s+)?(?:(?:to|as)\s+)?(.+)$/);
        if (renameMatch) {
            return {
                type: 'workflow',
                command: 'rename',
                args: [renameMatch[1].trim()],
                raw: input,
                isModelResolved: false
            };
        }

        // 2. Proceed 'proceed [workflow]'
        const proceedMatch: RegExpMatchArray | null = trimmedLower.match(/^proceed(?:\s+(.+))?$/);
        if (proceedMatch) {
            return {
                type: 'workflow',
                command: 'proceed',
                args: proceedMatch[1] ? [proceedMatch[1].trim()] : [],
                raw: input,
                isModelResolved: false
            };
        }

        // 3. System Commands (Special)
        const systemVerbs = ctx.systemCommands_list();
        const isSpecialPrefixed = trimmedLower.startsWith('/');
        const cleanVerb = isSpecialPrefixed ? trimmedLower.slice(1).split(/\s+/)[0] : trimmedLower.split(/\s+/)[0];

        if (systemVerbs.includes(cleanVerb)) {
            // Special case for 'status' which might be handled by workflow
            if (cleanVerb === 'status' && !isSpecialPrefixed && ctx.workflowHandles_status()) {
                // Let workflow handle it (continue to next phase)
            } else {
                const parts = (isSpecialPrefixed ? trimmedLower.slice(1) : trimmedLower).split(/\s+/);
                const args = parts.slice(1);
                return {
                    type: 'special',
                    command: cleanVerb,
                    args,
                    raw: input,
                    isModelResolved: false
                };
            }
        }

        // 4. DAG/Manifest Visualization
        const dagMatch: RegExpMatchArray | null = trimmed.match(/^\/?dag(?:\s+(.*))?$/i);
        if (dagMatch) {
            const rawArgs: string = (dagMatch[1] || '').trim();
            const args: string[] = rawArgs.length > 0 ? rawArgs.split(/\s+/) : ['show'];
            return {
                type: 'special',
                command: 'dag',
                args,
                raw: input,
                isModelResolved: false
            };
        }

        if (this.intentLooksLike_dagShow(trimmedLower)) {
            return {
                type: 'special',
                command: 'dag',
                args: ['show', '--where'],
                raw: input,
                isModelResolved: false
            };
        }

        // 5. Manifest-Declared Phrases (Exact Matching)
        const workflowVerbs: string[] = ctx.workflowCommands_resolve();
        
        // Longest Match First to prioritize "show container" over "show"
        const sortedVerbs = workflowVerbs.sort((a, b) => b.length - a.length);

        for (const phrase of sortedVerbs) {
            if (trimmedLower === phrase || trimmedLower.startsWith(phrase + ' ')) {
                const argsRaw = trimmed.slice(phrase.length).trim();
                let args = argsRaw.length > 0 ? argsRaw.split(/\s+/) : [];

                // Legacy filler stripping
                if (phrase === 'search' && args.length > 0 && args[0].toLowerCase() === 'for') {
                    args = args.slice(1);
                } else if (args.length > 0 && (args[0].toLowerCase() === 'the' || args[0].toLowerCase() === 'a')) {
                    args = args.slice(1);
                }

                return {
                    type: 'workflow',
                    command: phrase,
                    args,
                    raw: input,
                    isModelResolved: false
                };
            }
        }

        return null;
    }

    /**
     * Detect natural-language DAG visualization requests.
     */
    private intentLooksLike_dagShow(trimmed: string): boolean {
        const normalized: string = trimmed.replace(/[?!.]+$/g, '').trim();
        const patterns: RegExp[] = [
            /^dag(?:\s+show)?(?:\s+.*)?$/,
            /^(?:please\s+)?show(?:\s+me)?\s+(?:the\s+|this\s+)?(?:workflow|dag|manifest)(?:\s+.*)?$/,
            /^(?:please\s+)?(?:where\s+am\s+i|where\s+are\s+we)(?:\s+in(?:\s+the)?\s+(?:workflow|dag|manifest))?$/,
            /^(?:please\s+)?(?:show|display)\s+(?:workflow|dag)\s+(?:graph|tree|topology)$/,
        ];
        return patterns.some((pattern: RegExp): boolean => pattern.test(normalized));
    }
}
