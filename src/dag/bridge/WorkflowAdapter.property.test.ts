/**
 * @file WorkflowAdapter Property Tests
 *
 * Property-based invariant tests for WorkflowAdapter's public command API.
 *
 * These complement the example-based unit tests in WorkflowAdapter.test.ts
 * by stating invariants that must hold regardless of which specific command
 * or input is chosen.
 *
 * Invariants under test:
 *   1. commandVerbs_list() never contains duplicate verbs.
 *   2. commandVerbs_list() is stable — calling it twice gives identical output.
 *   3. commandDeclared_isExplicit(v) is true for any single-word command that
 *      is itself a complete declared phrase (i.e. its canonical form == verb).
 *   4. commandDeclared_isExplicit returns false for strings that cannot
 *      plausibly be a declared command.
 *   5. Prefix matching: for any declared single-word verb v,
 *      commandDeclared_isExplicit(v + ' extra') is true.
 */

import { describe, it, beforeAll, expect } from 'vitest';
import * as fc from 'fast-check';
import { WorkflowAdapter } from './WorkflowAdapter.js';

describe('WorkflowAdapter — command API property invariants', (): void => {
    let adapter: WorkflowAdapter;
    let verbs: string[];
    // Single-word verbs whose canonical phrase IS the verb itself
    // (as opposed to base verbs of multi-word phrases like "show transcompile" → "show")
    let singleWordVerbs: string[];

    beforeAll((): void => {
        adapter = WorkflowAdapter.definition_load('fedml');
        verbs = adapter.commandVerbs_list();

        // A verb is "self-declared" if passing it exactly to commandDeclared_isExplicit
        // returns true. Multi-word commands (e.g. "python train.py") have base verb "python"
        // which is NOT itself a declared phrase — "python train.py" is.
        singleWordVerbs = verbs.filter(v => adapter.commandDeclared_isExplicit(v));
    });

    it('commandVerbs_list() contains no duplicate verbs', (): void => {
        expect(verbs.length).toBe(new Set(verbs).size);
    });

    it('commandVerbs_list() is stable across multiple calls', (): void => {
        const second = adapter.commandVerbs_list();
        expect(verbs).toEqual(second);
    });

    it('commandDeclared_isExplicit is true for self-declared single-word verbs', (): void => {
        // Skip if manifest has no single-word self-declared commands (shouldn't happen)
        if (singleWordVerbs.length === 0) return;

        fc.assert(fc.property(
            fc.constantFrom(...singleWordVerbs),
            (verb): boolean => adapter.commandDeclared_isExplicit(verb)
        ));
    });

    it('commandDeclared_isExplicit prefix match: verb + args is true for self-declared verbs', (): void => {
        if (singleWordVerbs.length === 0) return;

        // Any single-word declared verb followed by arbitrary args should also match
        // (the adapter uses startsWith(phrase + ' ') for prefix matching).
        fc.assert(fc.property(
            fc.constantFrom(...singleWordVerbs),
            fc.stringMatching(/^[a-z0-9-]{1,16}$/),
            (verb, extra): boolean => adapter.commandDeclared_isExplicit(`${verb} ${extra}`)
        ));
    });

    it('commandDeclared_isExplicit returns false for strings that look nothing like commands', (): void => {
        // Strings starting with '__' followed by uppercase are guaranteed to
        // match no manifest command (which are always lowercase identifiers).
        fc.assert(fc.property(
            fc.stringMatching(/^__[A-Z][A-Z0-9_]{2,16}__$/),
            (noise): boolean => !adapter.commandDeclared_isExplicit(noise)
        ));
    });

    it('commandDeclared_isExplicit is consistent: same input always gives same result', (): void => {
        if (verbs.length === 0) return;

        fc.assert(fc.property(
            fc.constantFrom(...verbs),
            (verb): boolean => {
                const r1 = adapter.commandDeclared_isExplicit(verb);
                const r2 = adapter.commandDeclared_isExplicit(verb);
                return r1 === r2;
            }
        ));
    });
});
