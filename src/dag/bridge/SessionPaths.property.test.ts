/**
 * @file SessionPaths Property Tests
 *
 * Property-based invariant tests for `sessionPaths_compute`.
 *
 * These tests state mathematical claims that must hold for all valid DAG
 * topologies, not just the specific cases covered by example-based tests.
 * fast-check generates hundreds of random linear chains and verifies each.
 *
 * Invariants under test:
 *   1. Every stage in the DAG has an entry in the computed paths map.
 *   2. No stage ID appears twice in any resolved path.
 *   3. Root stage path is exactly <rootId>/meta (no ancestor prefix).
 *   4. Every non-root stage path starts with the root ID.
 *   5. artifactFile is always nested within dataDir.
 *   6. artifactFile ends with the stage's first produces value.
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { sessionPaths_compute } from './SessionPaths.js';
import type { DAGDefinition, DAGNode, ManifestHeader } from '../graph/types.js';

// ─── Fixture Builders ────────────────────────────────────────────────────────

const STUB_HEADER: ManifestHeader = {
    name: 'property-test', description: '', category: '',
    persona: 'test', version: '1.0.0', locked: false, authors: ''
};

function node_make(id: string, previous: string[] | null): DAGNode {
    return {
        id, name: id, phase: null, previous, optional: false,
        produces: [`${id}.json`], parameters: {}, instruction: '',
        commands: [id], handler: null, skip_warning: null,
        narrative: null, blueprint: []
    };
}

/**
 * Build a linear chain DAGDefinition from an ordered array of stage IDs.
 * Each stage's previous is the prior stage; the first stage is the root.
 */
function linearChain_build(ids: string[]): DAGDefinition {
    const nodes = new Map<string, DAGNode>();
    for (let i = 0; i < ids.length; i++) {
        nodes.set(ids[i], node_make(ids[i], i === 0 ? null : [ids[i - 1]]));
    }
    return {
        source: 'manifest',
        header: STUB_HEADER,
        nodes,
        orderedNodeIds: [...ids],
        edges: ids.slice(1).map((id, i) => ({ from: ids[i], to: id })),
        rootIds: [ids[0]],
        terminalIds: [ids[ids.length - 1]]
    };
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

/** Unique integer IDs mapped to stage names like 's0', 's1', ... */
const chainIds = fc.uniqueArray(
    fc.integer({ min: 0, max: 99 }),
    { minLength: 1, maxLength: 8 }
).map(nums => nums.map(n => `s${n}`));

/** Same but always at least 2 stages (so non-root invariants are meaningful). */
const chainIds_min2 = fc.uniqueArray(
    fc.integer({ min: 0, max: 99 }),
    { minLength: 2, maxLength: 8 }
).map(nums => nums.map(n => `s${n}`));

// ─── Properties ──────────────────────────────────────────────────────────────

describe('SessionPaths — property invariants', (): void => {
    it('every stage has an entry in the computed paths map', (): void => {
        fc.assert(fc.property(chainIds, (ids): boolean => {
            const paths = sessionPaths_compute(linearChain_build(ids));
            return ids.every(id => paths.has(id));
        }));
    });

    it('no stage ID appears twice in any resolved path', (): void => {
        fc.assert(fc.property(chainIds, (ids): boolean => {
            const paths = sessionPaths_compute(linearChain_build(ids));
            for (const stagePath of paths.values()) {
                // strip the trailing '/meta' leaf, split on '/' to get stage segments
                const segments = stagePath.dataDir.replace(/\/meta$/, '').split('/');
                if (segments.length !== new Set(segments).size) return false;
            }
            return true;
        }));
    });

    it('root stage path is exactly <rootId>/meta — no ancestor prefix', (): void => {
        fc.assert(fc.property(chainIds, (ids): boolean => {
            const paths = sessionPaths_compute(linearChain_build(ids));
            const rootPath = paths.get(ids[0])!;
            return rootPath.dataDir === `${ids[0]}/meta`;
        }));
    });

    it('every non-root stage path starts with the root ID', (): void => {
        fc.assert(fc.property(chainIds_min2, (ids): boolean => {
            const paths = sessionPaths_compute(linearChain_build(ids));
            const rootId = ids[0];
            return ids.slice(1).every(id => paths.get(id)!.dataDir.startsWith(`${rootId}/`));
        }));
    });

    it('artifactFile is always nested within dataDir', (): void => {
        fc.assert(fc.property(chainIds, (ids): boolean => {
            const paths = sessionPaths_compute(linearChain_build(ids));
            for (const p of paths.values()) {
                if (!p.artifactFile.startsWith(p.dataDir + '/')) return false;
            }
            return true;
        }));
    });

    it('artifactFile ends with the stage produces[0] artifact name', (): void => {
        fc.assert(fc.property(chainIds, (ids): boolean => {
            const def = linearChain_build(ids);
            const paths = sessionPaths_compute(def);
            for (const [id, p] of paths) {
                const expected = def.nodes.get(id)!.produces[0];
                if (!p.artifactFile.endsWith(expected)) return false;
            }
            return true;
        }));
    });
});
