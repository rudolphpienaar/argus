/**
 * @file IntentParser / FastPathRouter Property Tests
 *
 * Property-based invariant tests for the deterministic routing layer.
 *
 * The central claim of the FastPath is: any input that exactly matches a
 * manifest-declared command phrase is resolved deterministically, WITHOUT
 * going to the LLM. This is the "no LLM escape" invariant — the guarantee
 * that workflow commands never accidentally fall through to the AI.
 *
 * These tests state that invariant mathematically over the actual fedml
 * manifest command vocabulary, covering every declared verb.
 *
 * Invariants under test:
 *   1. For any manifest command verb, intent_resolve returns non-null.
 *   2. The resolved intent always has isModelResolved === false.
 *   3. The resolved intent type is 'workflow'.
 *   4. The resolved command field matches the input phrase.
 *   5. Prefix matching: verb + trailing args still fast-paths.
 *   6. Empty string never fast-paths (router returns null).
 */

import { describe, it, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import { FastPathRouter } from '../../lcarslm/kernel/FastPathRouter.js';
import type { FastPathContext } from '../../lcarslm/kernel/FastPathRouter.js';
import { WorkflowAdapter } from '../../dag/bridge/WorkflowAdapter.js';

// ─── Fixture ─────────────────────────────────────────────────────────────────

function ctx_make(commands: string[]): FastPathContext {
    return {
        workflowCommands_resolve: () => commands,
        systemCommands_list: () => [],
        workflowHandles_status: () => false
    };
}

// ─── Properties ──────────────────────────────────────────────────────────────

describe('FastPathRouter — no-LLM-escape invariants', (): void => {
    const router = new FastPathRouter();
    let adapter: WorkflowAdapter;
    let verbs: string[];
    // The subset of verbs that themselves fast-path (single-word declared phrases).
    // Multi-word base verbs (e.g. "python" from "python train.py") require the
    // full phrase — they're tested separately.
    let fastPathVerbs: string[];
    let ctx: FastPathContext;

    beforeAll((): void => {
        adapter = WorkflowAdapter.definition_load('fedml');
        verbs = adapter.commandVerbs_list();

        // Build the same command list the IntentParser would pass to the router:
        // all declared verbs, lowercased.
        ctx = ctx_make(verbs);

        // A verb fast-paths if it exactly satisfies commandDeclared_isExplicit —
        // meaning it IS a full declared phrase (not just the base of a multi-word one).
        fastPathVerbs = verbs.filter(v => adapter.commandDeclared_isExplicit(v));
    });

    it('every declared single-word verb fast-paths to a non-null intent', (): void => {
        if (fastPathVerbs.length === 0) return;

        fc.assert(fc.property(
            fc.constantFrom(...fastPathVerbs),
            (verb): boolean => router.intent_resolve(verb, ctx) !== null
        ));
    });

    it('fast-pathed intents always have isModelResolved === false', (): void => {
        if (fastPathVerbs.length === 0) return;

        fc.assert(fc.property(
            fc.constantFrom(...fastPathVerbs),
            (verb): boolean => {
                const intent = router.intent_resolve(verb, ctx);
                return intent !== null && intent.isModelResolved === false;
            }
        ));
    });

    it('fast-pathed intents have type === workflow', (): void => {
        if (fastPathVerbs.length === 0) return;

        fc.assert(fc.property(
            fc.constantFrom(...fastPathVerbs),
            (verb): boolean => {
                const intent = router.intent_resolve(verb, ctx);
                return intent !== null && intent.type === 'workflow';
            }
        ));
    });

    it('the resolved command field matches the matched phrase', (): void => {
        if (fastPathVerbs.length === 0) return;

        fc.assert(fc.property(
            fc.constantFrom(...fastPathVerbs),
            (verb): boolean => {
                const intent = router.intent_resolve(verb, ctx);
                return intent !== null && intent.command === verb;
            }
        ));
    });

    it('verb + trailing args still fast-paths (prefix matching)', (): void => {
        if (fastPathVerbs.length === 0) return;

        fc.assert(fc.property(
            fc.constantFrom(...fastPathVerbs),
            fc.stringMatching(/^[a-z0-9-]{1,16}$/),
            (verb, extra): boolean => {
                const intent = router.intent_resolve(`${verb} ${extra}`, ctx);
                // Prefix match must fire and result must be deterministic
                return intent !== null &&
                    intent.isModelResolved === false &&
                    intent.command === verb;
            }
        ));
    });

    it('empty string never fast-paths', (): void => {
        const intent = router.intent_resolve('', ctx);
        // Vitest's expect is available here — property assertions not needed
        // for a single deterministic case
        if (intent !== null) throw new Error('Empty string should not fast-path');
    });

    it('whitespace-only input never fast-paths', (): void => {
        fc.assert(fc.property(
            fc.stringMatching(/^\s+$/),
            (ws): boolean => router.intent_resolve(ws, ctx) === null
        ));
    });
});
