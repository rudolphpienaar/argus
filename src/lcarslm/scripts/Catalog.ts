/**
 * @file Built-in Calypso script catalog.
 *
 * These scripts are deterministic command bundles that can execute in both
 * embedded ARGUS and headless CLI/server modes.
 *
 * @module
 */

/** Metadata + step sequence for a built-in script. */
export interface CalypsoScript {
    /** Stable script identifier used by `/run <id>` */
    id: string;
    /** One-line summary shown in `/scripts` */
    description: string;
    /** Optional aliases (e.g., legacy script names) */
    aliases: string[];
    /** Prerequisite keys checked before execution */
    requires: string[];
    /** Suggested target stage */
    target: 'gather' | 'harmonize' | 'code' | 'train' | 'federate';
    /** Deterministic command sequence */
    steps: string[];
}

const BUILTIN_SCRIPTS: ReadonlyArray<CalypsoScript> = [
    {
        id: 'hist-harmonize',
        description: 'Histology fast path: search -> add -> rename -> harmonize',
        aliases: ['harmonize', 'hist_harmonize'],
        requires: [],
        target: 'harmonize',
        steps: [
            'search histology',
            'add ds-006',
            'rename histo-exp1',
            'harmonize'
        ]
    }
];

/**
 * Get all built-in scripts.
 *
 * @returns Script catalog entries.
 */
export function scripts_list(): ReadonlyArray<CalypsoScript> {
    return BUILTIN_SCRIPTS;
}

/**
 * Resolve a script reference by ID or alias.
 *
 * @param ref - User-provided reference.
 * @returns Script definition or null if not found.
 */
export function script_find(ref: string): CalypsoScript | null {
    const normalized: string = scriptRef_normalize(ref);
    if (!normalized) return null;

    for (const script of BUILTIN_SCRIPTS) {
        if (script.id === normalized) return script;
        if (script.aliases.some((alias: string): boolean => alias === normalized)) return script;
    }

    return null;
}

/**
 * Normalize a user script reference.
 *
 * @param ref - Raw script reference.
 * @returns Normalized lowercase reference.
 */
function scriptRef_normalize(ref: string): string {
    return ref
        .trim()
        .toLowerCase()
        .replace(/\.clpso$/i, '');
}

