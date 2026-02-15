/**
 * @file DAG Fingerprint Layer Tests
 *
 * TDD tests for the fingerprint layer: hash computation, Merkle chain
 * validation, and staleness detection. Tests are written against
 * interfaces before implementation exists.
 *
 * @module dag/fingerprint
 * @see docs/dag-engine.adoc
 */

import { describe, it, expect } from 'vitest';
import type {
    FingerprintRecord,
    StalenessResult,
    ChainValidationResult,
    FingerprintHasher,
} from './types.js';
import { fingerprint_compute, Sha256Hasher } from './hasher.js';
import { staleness_check, chain_validate } from './chain.js';
import { manifest_parse } from '../graph/parser/manifest.js';

// ═══════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════

/**
 * Deterministic test hasher that produces predictable fingerprints.
 * Uses simple string concatenation instead of SHA-256 for test clarity.
 */
const testHasher: FingerprintHasher = {
    fingerprint_compute(content: string, parentFingerprints: Record<string, string>): string {
        const parentPart = Object.entries(parentFingerprints)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${v}`)
            .join(',');
        return `hash(${content}|${parentPart})`;
    },
};

// ═══════════════════════════════════════════════════════════════════
// Hasher Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/fingerprint/hasher', () => {

    it('should produce a non-empty fingerprint from content', () => {
        const fp = fingerprint_compute('{"datasets":["ds-001"]}', {});
        expect(fp).toBeTruthy();
        expect(fp.length).toBeGreaterThan(0);
    });

    it('should produce deterministic output for same input', () => {
        const fp1 = fingerprint_compute('content', { a: '1' });
        const fp2 = fingerprint_compute('content', { a: '1' });
        expect(fp1).toBe(fp2);
    });

    it('should produce different output for different content', () => {
        const fp1 = fingerprint_compute('content-a', {});
        const fp2 = fingerprint_compute('content-b', {});
        expect(fp1).not.toBe(fp2);
    });

    it('should include parent fingerprints in computation', () => {
        const fp1 = fingerprint_compute('same', { parent: 'fp-1' });
        const fp2 = fingerprint_compute('same', { parent: 'fp-2' });
        expect(fp1).not.toBe(fp2);
    });

    it('should be order-independent on parent fingerprints', () => {
        const fp1 = fingerprint_compute('content', { a: 'fp1', b: 'fp2' });
        const fp2 = fingerprint_compute('content', { b: 'fp2', a: 'fp1' });
        expect(fp1).toBe(fp2);
    });

    it('should handle root node with no parents', () => {
        const fp = fingerprint_compute('root content', {});
        expect(fp).toBeTruthy();
        expect(typeof fp).toBe('string');
    });

    it('should handle multiple parents (join node)', () => {
        const fp = fingerprint_compute('join content', { gather: 'fp1', rename: 'fp2' });
        expect(fp).toBeTruthy();
        expect(typeof fp).toBe('string');
    });
});

// ═══════════════════════════════════════════════════════════════════
// Chain Validation Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/fingerprint/chain', () => {

    // Minimal linear manifest for chain tests
    const LINEAR_YAML = `
name: "Chain Test"
description: "Linear chain for fingerprint tests"
category: Testing
persona: test
version: 1.0.0
locked: false
authors: Test

stages:
  - id: search
    name: Search
    previous: ~
    optional: false
    produces: [search.json]
    parameters: {}
    instruction: "Search."
    commands: [search]

  - id: gather
    name: Gather
    previous: search
    optional: false
    produces: [gather.json]
    parameters: {}
    instruction: "Gather."
    commands: [gather]

  - id: harmonize
    name: Harmonize
    previous: gather
    optional: false
    produces: [harmonize.json]
    parameters: {}
    instruction: "Harmonize."
    commands: [harmonize]
`;

    // Branch-join manifest for join staleness tests
    const BRANCH_YAML = `
name: "Branch Chain Test"
description: "Branch-join for staleness tests"
category: Testing
persona: test
version: 1.0.0
locked: false
authors: Test

stages:
  - id: search
    name: Search
    previous: ~
    optional: false
    produces: [search.json]
    parameters: {}
    instruction: "Search."
    commands: [search]

  - id: gather
    name: Gather
    previous: search
    optional: false
    produces: [gather.json]
    parameters: {}
    instruction: "Gather."
    commands: [gather]

  - id: rename
    name: Rename
    previous: gather
    optional: true
    produces: [rename.json]
    parameters: {}
    instruction: "Rename."
    commands: [rename]

  - id: harmonize
    name: Harmonize
    previous: [gather, rename]
    optional: false
    produces: [harmonize.json]
    parameters: {}
    instruction: "Harmonize."
    commands: [harmonize]
`;

    describe('staleness detection', () => {

        it('should detect no staleness when chain is fresh', () => {
            const result = staleness_check(
                'gather',
                { fingerprint: 'fp-gather', parentFingerprints: { search: 'fp-search' } },
                { search: 'fp-search' },
            );
            expect(result.stale).toBe(false);
            expect(result.staleParents).toEqual([]);
        });

        it('should detect staleness when parent re-executed', () => {
            const result = staleness_check(
                'gather',
                { fingerprint: 'fp-gather', parentFingerprints: { search: 'fp-search-old' } },
                { search: 'fp-search-new' },
            );
            expect(result.stale).toBe(true);
            expect(result.staleParents).toEqual(['search']);
        });

        it('should detect cascading staleness', () => {
            const def = manifest_parse(LINEAR_YAML);
            // search re-run with new fp, gather and harmonize have old parent fps
            const artifacts = new Map<string, FingerprintRecord>([
                ['search', { fingerprint: 'fp-search-v2', parentFingerprints: {} }],
                ['gather', { fingerprint: 'fp-gather', parentFingerprints: { search: 'fp-search-v1' } }],
                ['harmonize', { fingerprint: 'fp-harmonize', parentFingerprints: { gather: 'fp-gather' } }],
            ]);
            const result = chain_validate(def, (id) => artifacts.get(id) ?? null);
            expect(result.valid).toBe(false);
            expect(result.staleStages.length).toBe(2);
            const staleIds = result.staleStages.map(s => s.stageId);
            expect(staleIds).toContain('gather');
            expect(staleIds).toContain('harmonize');
        });

        it('should not detect staleness for content-identical re-execution', () => {
            const result = staleness_check(
                'gather',
                { fingerprint: 'fp-gather', parentFingerprints: { search: 'fp-search' } },
                { search: 'fp-search' }, // Same fp — content-identical re-run
            );
            expect(result.stale).toBe(false);
        });

        it('should detect staleness on join nodes from any parent', () => {
            // harmonize records both gather and rename fingerprints
            const result = staleness_check(
                'harmonize',
                {
                    fingerprint: 'fp-harmonize',
                    parentFingerprints: { gather: 'fp-gather', rename: 'fp-rename-old' },
                },
                { gather: 'fp-gather', rename: 'fp-rename-new' },
            );
            expect(result.stale).toBe(true);
            expect(result.staleParents).toEqual(['rename']);
        });

        it('should handle skip sentinels in chain', () => {
            // rename was skipped (sentinel fp), harmonize recorded it
            // Now rename is performed for real → different fp → harmonize stale
            const result = staleness_check(
                'harmonize',
                {
                    fingerprint: 'fp-harmonize',
                    parentFingerprints: { gather: 'fp-gather', rename: 'fp-rename-sentinel' },
                },
                { gather: 'fp-gather', rename: 'fp-rename-real' },
            );
            expect(result.stale).toBe(true);
            expect(result.staleParents).toEqual(['rename']);
        });
    });

    describe('chain validation', () => {

        it('should validate a complete, consistent chain', () => {
            const def = manifest_parse(LINEAR_YAML);
            const artifacts = new Map<string, FingerprintRecord>([
                ['search', { fingerprint: 'fp-search', parentFingerprints: {} }],
                ['gather', { fingerprint: 'fp-gather', parentFingerprints: { search: 'fp-search' } }],
                ['harmonize', { fingerprint: 'fp-harmonize', parentFingerprints: { gather: 'fp-gather' } }],
            ]);
            const result = chain_validate(def, (id) => artifacts.get(id) ?? null);
            expect(result.valid).toBe(true);
            expect(result.staleStages).toEqual([]);
            expect(result.missingStages).toEqual([]);
        });

        it('should report missing stages', () => {
            const def = manifest_parse(LINEAR_YAML);
            const artifacts = new Map<string, FingerprintRecord>([
                ['search', { fingerprint: 'fp-search', parentFingerprints: {} }],
                // gather missing
                // harmonize missing
            ]);
            const result = chain_validate(def, (id) => artifacts.get(id) ?? null);
            expect(result.valid).toBe(false);
            expect(result.missingStages).toContain('gather');
            expect(result.missingStages).toContain('harmonize');
        });

        it('should report both stale and missing stages', () => {
            const def = manifest_parse(LINEAR_YAML);
            const artifacts = new Map<string, FingerprintRecord>([
                ['search', { fingerprint: 'fp-search-v2', parentFingerprints: {} }],
                ['gather', { fingerprint: 'fp-gather', parentFingerprints: { search: 'fp-search-v1' } }],
                // harmonize missing
            ]);
            const result = chain_validate(def, (id) => artifacts.get(id) ?? null);
            expect(result.valid).toBe(false);
            expect(result.staleStages.length).toBeGreaterThan(0);
            expect(result.missingStages).toContain('harmonize');
        });

        it('should validate a partial chain (up to current stage)', () => {
            // Only search and gather materialized — chain is valid up to gather
            // We validate only what's present; missing downstream is reported
            const def = manifest_parse(LINEAR_YAML);
            const artifacts = new Map<string, FingerprintRecord>([
                ['search', { fingerprint: 'fp-search', parentFingerprints: {} }],
                ['gather', { fingerprint: 'fp-gather', parentFingerprints: { search: 'fp-search' } }],
            ]);
            const result = chain_validate(def, (id) => artifacts.get(id) ?? null);
            // Missing harmonize makes it invalid overall
            expect(result.missingStages).toContain('harmonize');
            // But no stale stages
            expect(result.staleStages).toEqual([]);
        });

        it('should handle single-node chain (root only)', () => {
            const def = manifest_parse(LINEAR_YAML);
            const artifacts = new Map<string, FingerprintRecord>([
                ['search', { fingerprint: 'fp-search', parentFingerprints: {} }],
            ]);
            const result = chain_validate(def, (id) => artifacts.get(id) ?? null);
            // Missing gather and harmonize, but search itself is valid
            expect(result.staleStages).toEqual([]);
            expect(result.missingStages).toContain('gather');
        });
    });
});

// ═══════════════════════════════════════════════════════════════════
// Type Contract Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/fingerprint/types contracts', () => {

    it('FingerprintRecord stores fingerprint and parent map', () => {
        const record: FingerprintRecord = {
            fingerprint: 'a3f8c2d1e5',
            parentFingerprints: { search: '7b2e9134' },
        };
        expect(record.fingerprint).toBeTruthy();
        expect(record.parentFingerprints['search']).toBe('7b2e9134');
    });

    it('FingerprintRecord for root has empty parent map', () => {
        const record: FingerprintRecord = {
            fingerprint: '7b2e9134',
            parentFingerprints: {},
        };
        expect(Object.keys(record.parentFingerprints)).toHaveLength(0);
    });

    it('StalenessResult identifies stale parents', () => {
        const result: StalenessResult = {
            stageId: 'harmonize',
            stale: true,
            staleParents: ['rename'],
            currentFingerprint: 'b7d1e4f2',
        };
        expect(result.stale).toBe(true);
        expect(result.staleParents).toContain('rename');
    });

    it('StalenessResult for fresh stage has no stale parents', () => {
        const result: StalenessResult = {
            stageId: 'gather',
            stale: false,
            staleParents: [],
            currentFingerprint: 'a3f8c2d1',
        };
        expect(result.stale).toBe(false);
        expect(result.staleParents).toHaveLength(0);
    });

    it('StalenessResult for unmaterialized stage has null fingerprint', () => {
        const result: StalenessResult = {
            stageId: 'code',
            stale: false,
            staleParents: [],
            currentFingerprint: null,
        };
        expect(result.currentFingerprint).toBeNull();
    });

    it('ChainValidationResult reports overall validity', () => {
        const valid: ChainValidationResult = {
            valid: true,
            staleStages: [],
            missingStages: [],
        };
        expect(valid.valid).toBe(true);

        const invalid: ChainValidationResult = {
            valid: false,
            staleStages: [{
                stageId: 'gather',
                stale: true,
                staleParents: ['search'],
                currentFingerprint: 'old-fp',
            }],
            missingStages: ['harmonize'],
        };
        expect(invalid.valid).toBe(false);
        expect(invalid.staleStages).toHaveLength(1);
        expect(invalid.missingStages).toContain('harmonize');
    });

    it('FingerprintHasher interface produces deterministic results', () => {
        const fp1 = testHasher.fingerprint_compute('content', { a: '1' });
        const fp2 = testHasher.fingerprint_compute('content', { a: '1' });
        expect(fp1).toBe(fp2);
    });

    it('FingerprintHasher includes parents in computation', () => {
        const fp1 = testHasher.fingerprint_compute('content', { a: '1' });
        const fp2 = testHasher.fingerprint_compute('content', { a: '2' });
        expect(fp1).not.toBe(fp2);
    });

    it('FingerprintHasher is parent-order-independent', () => {
        const fp1 = testHasher.fingerprint_compute('content', { a: '1', b: '2' });
        const fp2 = testHasher.fingerprint_compute('content', { b: '2', a: '1' });
        expect(fp1).toBe(fp2);
    });
});
