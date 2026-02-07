/**
 * @file Control Plane Intent Router
 *
 * Deterministically separates "control-plane" intents (scripts automation)
 * from conversational intents so CALYPSO does not fall back to the LLM for
 * structured operational requests.
 *
 * @module
 */

/** Script descriptor consumed by the router. */
export interface ControlScriptDescriptor {
    /** Stable script identifier */
    id: string;
    /** Alias list */
    aliases: string[];
}

/** Control-plane intent variants. */
export type ControlPlaneIntent =
    | { plane: 'conversation' }
    | { plane: 'control'; action: 'scripts_list' }
    | { plane: 'control'; action: 'script_show'; scriptRef: string }
    | { plane: 'control'; action: 'script_run'; scriptRef: string; dryRun: boolean }
    | { plane: 'control'; action: 'script_run_ambiguous'; candidates: string[]; dryRun: boolean };

const RUN_VERBS: ReadonlySet<string> = new Set([
    'run', 'execute', 'start', 'launch', 'trigger'
]);

const LIST_CUES: ReadonlySet<string> = new Set([
    'list', 'show', 'available', 'have', 'which', 'what'
]);

const DETAIL_CUES: ReadonlySet<string> = new Set([
    'detail', 'details', 'about', 'describe', 'inspect'
]);

const SCRIPT_NOUNS: ReadonlySet<string> = new Set([
    'script', 'scripts', 'powerscript', 'powerscripts',
    'automation', 'automations', 'flow', 'flows'
]);

const DRY_CUES: ReadonlySet<string> = new Set([
    'dry', 'preview', 'plan'
]);

/**
 * Resolve a user utterance to control-plane vs conversation intent.
 *
 * @param input - Raw user input.
 * @param scripts - Available script descriptors.
 * @returns Deterministic intent classification.
 */
export function controlPlaneIntent_resolve(
    input: string,
    scripts: ReadonlyArray<ControlScriptDescriptor>
): ControlPlaneIntent {
    const normalized: string = text_normalize(input);
    if (!normalized) return { plane: 'conversation' };

    const tokens: string[] = normalized.split(' ').filter((token: string): boolean => token.length > 0);
    if (tokens.length === 0) return { plane: 'conversation' };

    const hasRunCue: boolean = tokenSet_containsAny(tokens, RUN_VERBS);
    const hasListCue: boolean = tokenSet_containsAny(tokens, LIST_CUES);
    const hasDetailCue: boolean = tokenSet_containsAny(tokens, DETAIL_CUES);
    const hasDryCue: boolean = tokenSet_containsAny(tokens, DRY_CUES);
    const hasScriptNoun: boolean = tokenSet_containsAny(tokens, SCRIPT_NOUNS) ||
        (tokens.includes('power') && (tokens.includes('script') || tokens.includes('scripts')));

    const matchedScripts: string[] = scriptMatches_resolve(tokens, scripts);

    if (matchedScripts.length > 1 && hasRunCue) {
        return { plane: 'control', action: 'script_run_ambiguous', candidates: matchedScripts, dryRun: hasDryCue };
    }

    if (matchedScripts.length === 1) {
        const target: string = matchedScripts[0];

        if (hasRunCue) {
            return { plane: 'control', action: 'script_run', scriptRef: target, dryRun: hasDryCue };
        }

        if (hasDetailCue || hasListCue || hasScriptNoun) {
            return { plane: 'control', action: 'script_show', scriptRef: target };
        }
    }

    // Generic "run scripts/power scripts" intent with no specific script name:
    // route to list so CALYPSO can help user choose a script.
    if (hasRunCue && hasScriptNoun && matchedScripts.length === 0) {
        return { plane: 'control', action: 'scripts_list' };
    }

    if (hasScriptNoun && (hasListCue || !hasRunCue)) {
        return { plane: 'control', action: 'scripts_list' };
    }

    return { plane: 'conversation' };
}

/**
 * Normalize user text for token-based routing.
 *
 * @param value - Raw user text.
 * @returns Lowercased token-friendly string.
 */
function text_normalize(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9/_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Check whether any token exists in a lexicon.
 *
 * @param tokens - Input tokens.
 * @param lexicon - Allowed lexicon.
 * @returns True if overlap exists.
 */
function tokenSet_containsAny(tokens: string[], lexicon: ReadonlySet<string>): boolean {
    for (const token of tokens) {
        if (lexicon.has(token)) return true;
    }
    return false;
}

/**
 * Resolve script matches from token sequence.
 *
 * @param tokens - Normalized user tokens.
 * @param scripts - Script descriptors.
 * @returns Unique script IDs that matched.
 */
function scriptMatches_resolve(
    tokens: string[],
    scripts: ReadonlyArray<ControlScriptDescriptor>
): string[] {
    const matches: Set<string> = new Set<string>();

    for (const script of scripts) {
        const refs: string[] = [script.id, ...script.aliases];
        for (const ref of refs) {
            const forms: string[][] = scriptRef_forms(ref);
            if (forms.some((form: string[]): boolean => tokenSequence_contains(tokens, form))) {
                matches.add(script.id);
                break;
            }
        }
    }

    return Array.from(matches).sort((a: string, b: string): number => a.localeCompare(b));
}

/**
 * Build token forms for a script ref/alias.
 *
 * @param ref - Script reference.
 * @returns Tokenized matching forms.
 */
function scriptRef_forms(ref: string): string[][] {
    const normalized: string = ref.toLowerCase().trim();
    if (!normalized) return [];

    const forms: string[] = [
        normalized,
        normalized.replace(/_/g, '-'),
        normalized.replace(/-/g, '_'),
        normalized.replace(/[-_]/g, ' ')
    ];

    const tokenForms: string[][] = [];
    for (const form of forms) {
        const tokens: string[] = form.split(/[\s]+/).filter((token: string): boolean => token.length > 0);
        if (tokens.length > 0) tokenForms.push(tokens);
    }

    return tokenForms;
}

/**
 * Determine if a token sequence contains a contiguous sub-sequence.
 *
 * @param haystack - Main token sequence.
 * @param needle - Candidate sub-sequence.
 * @returns True if contiguous match exists.
 */
function tokenSequence_contains(haystack: string[], needle: string[]): boolean {
    if (needle.length === 0 || haystack.length < needle.length) return false;

    for (let i: number = 0; i <= haystack.length - needle.length; i++) {
        let matched: boolean = true;
        for (let j: number = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) {
                matched = false;
                break;
            }
        }
        if (matched) return true;
    }

    return false;
}
