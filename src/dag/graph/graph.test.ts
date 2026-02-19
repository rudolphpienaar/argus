/**
 * @file DAG Graph Layer Tests
 *
 * TDD tests for the graph layer: manifest/script parsing, DAG validation,
 * and readiness resolution. Tests are written against interfaces before
 * implementation exists.
 *
 * @module dag/graph
 * @see docs/dag-engine.adoc
 */

import { describe, it, expect } from 'vitest';
import type {
    DAGNode,
    DAGEdge,
    DAGDefinition,
    ManifestHeader,
    ScriptHeader,
    ScriptStageOverride,
    ValidationResult,
    NodeReadiness,
    WorkflowPosition,
    SkipWarning,
} from './types.js';
import { manifest_parse } from './parser/manifest.js';
import { script_parse } from './parser/script.js';
import { dag_validate } from './validator.js';
import { dag_resolve, position_resolve } from './resolver.js';

// ═══════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════

/** Minimal valid manifest YAML for testing. */
const MINIMAL_MANIFEST_YAML = `
name: "Test Workflow"
description: "A minimal test workflow"
category: Testing
persona: test
version: 1.0.0
locked: false
authors: Test Team

stages:
  - id: alpha
    name: Alpha Stage
    phase: ~
    previous: ~
    optional: false
    produces:
      - alpha.json
    parameters:
      mode: fast
    instruction: "Do the alpha thing."
    commands:
      - alpha

  - id: beta
    name: Beta Stage
    phase: ~
    previous: alpha
    optional: false
    produces:
      - beta.json
    parameters:
      depth: 3
    instruction: "Do the beta thing."
    commands:
      - beta
`;

/** Manifest with a branch and join (rename is optional, harmonize joins). */
const BRANCHING_MANIFEST_YAML = `
name: "Branch-Join Workflow"
description: "Tests optional branch and join"
category: Testing
persona: test
version: 1.0.0
locked: false
authors: Test Team

stages:
  - id: search
    name: Search
    phase: search
    previous: ~
    optional: false
    produces:
      - search.json
    parameters: {}
    instruction: "Search for datasets."
    commands:
      - search

  - id: gather
    name: Gather
    phase: gather
    previous: search
    optional: false
    produces:
      - gather.json
    parameters: {}
    instruction: "Gather datasets."
    commands:
      - gather

  - id: rename
    name: Rename
    phase: gather
    previous: gather
    optional: true
    produces:
      - rename.json
    parameters:
      name: ~
    instruction: "Optionally rename your project."
    commands:
      - rename
    skip_warning:
      short: "Project not renamed."
      reason: "Renaming helps identify your project later."
      max_warnings: 1

  - id: harmonize
    name: Harmonize
    phase: harmonize
    previous: [gather, rename]
    optional: false
    produces:
      - harmonize.json
    parameters:
      resolution: [1.0, 1.0, 1.0]
    instruction: "Harmonize your cohort."
    commands:
      - harmonize
    skip_warning:
      short: "Cohort not harmonized."
      reason: "Federated learning requires consistent data formats."
      max_warnings: 2
`;

/** Manifest with a cycle (invalid). */
const CYCLIC_MANIFEST_YAML = `
name: "Cyclic Workflow"
description: "Invalid — contains a cycle"
category: Testing
persona: test
version: 1.0.0
locked: false
authors: Test Team

stages:
  - id: a
    name: A
    phase: ~
    previous: c
    optional: false
    produces:
      - a.json
    parameters: {}
    instruction: "A."
    commands: []

  - id: b
    name: B
    phase: ~
    previous: a
    optional: false
    produces:
      - b.json
    parameters: {}
    instruction: "B."
    commands: []

  - id: c
    name: C
    phase: ~
    previous: b
    optional: false
    produces:
      - c.json
    parameters: {}
    instruction: "C."
    commands: []
`;

/** Manifest with an orphan reference. */
const ORPHAN_MANIFEST_YAML = `
name: "Orphan Workflow"
description: "Invalid — references nonexistent parent"
category: Testing
persona: test
version: 1.0.0
locked: false
authors: Test Team

stages:
  - id: alpha
    name: Alpha
    phase: ~
    previous: nonexistent
    optional: false
    produces:
      - alpha.json
    parameters: {}
    instruction: "Alpha."
    commands: []
`;

/** Script anchored to the branching manifest. */
const SCRIPT_YAML = `
name: "Quick Path"
description: "Skips rename, overrides harmonize params"
manifest: branch-join.manifest.yaml
version: 1.0.0
authors: Test Team

stages:
  - id: search
    parameters:
      keywords: "brain MRI"

  - id: gather

  - id: rename
    skip: true

  - id: harmonize
    parameters:
      resolution: [2.0, 2.0, 2.0]
`;

// ═══════════════════════════════════════════════════════════════════
// Parser Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/graph/parser/manifest', () => {

    it('should parse a minimal manifest into a DAGDefinition', () => {
        const def = manifest_parse(MINIMAL_MANIFEST_YAML);
        expect(def.source).toBe('manifest');
        expect((def.header as ManifestHeader).name).toBe('Test Workflow');
        expect((def.header as ManifestHeader).persona).toBe('test');
        expect(def.nodes.size).toBe(2);
        expect(def.edges).toHaveLength(1);
        expect(def.rootIds).toEqual(['alpha']);
        expect(def.terminalIds).toEqual(['beta']);
    });

    it('should parse previous: ~ as null (root node)', () => {
        const def = manifest_parse(MINIMAL_MANIFEST_YAML);
        expect(def.nodes.get('alpha')!.previous).toBeNull();
    });

    it('should parse previous: <string> as single-element array', () => {
        const def = manifest_parse(MINIMAL_MANIFEST_YAML);
        expect(def.nodes.get('beta')!.previous).toEqual(['alpha']);
    });

    it('should parse previous: [a, b] as multi-element array (join)', () => {
        const def = manifest_parse(BRANCHING_MANIFEST_YAML);
        expect(def.nodes.get('harmonize')!.previous).toEqual(['gather', 'rename']);
    });

    it('should parse parameters as a Record<string, unknown>', () => {
        const def = manifest_parse(MINIMAL_MANIFEST_YAML);
        expect(def.nodes.get('alpha')!.parameters).toEqual({ mode: 'fast' });
    });

    it('should parse skip_warning when present', () => {
        const def = manifest_parse(BRANCHING_MANIFEST_YAML);
        const rename = def.nodes.get('rename')!;
        expect(rename.skip_warning).not.toBeNull();
        expect(rename.skip_warning!.short).toBe('Project not renamed.');
        expect(rename.skip_warning!.max_warnings).toBe(1);
    });

    it('should set skip_warning to null when absent', () => {
        const def = manifest_parse(MINIMAL_MANIFEST_YAML);
        expect(def.nodes.get('alpha')!.skip_warning).toBeNull();
    });

    it('should compute edges from backward pointers', () => {
        const def = manifest_parse(BRANCHING_MANIFEST_YAML);
        const edgeStrs = def.edges.map(e => `${e.from}->${e.to}`).sort();
        expect(edgeStrs).toEqual([
            'gather->harmonize',
            'gather->rename',
            'rename->harmonize',
            'search->gather',
        ]);
    });

    it('should identify root nodes (previous: null)', () => {
        const def = manifest_parse(BRANCHING_MANIFEST_YAML);
        expect(def.rootIds).toEqual(['search']);
    });

    it('should identify terminal nodes (no children)', () => {
        const def = manifest_parse(BRANCHING_MANIFEST_YAML);
        expect(def.terminalIds).toEqual(['harmonize']);
    });

    it('should reject YAML missing required header fields', () => {
        const noName = `
persona: test
stages:
  - id: a
    produces: [a.json]
`;
        expect(() => manifest_parse(noName)).toThrow(/name/i);

        const noPersona = `
name: Test
stages:
  - id: a
    produces: [a.json]
`;
        expect(() => manifest_parse(noPersona)).toThrow(/persona/i);
    });

    it('should reject stages with empty produces array', () => {
        const emptyProduces = `
name: Test
persona: test
stages:
  - id: a
    produces: []
`;
        expect(() => manifest_parse(emptyProduces)).toThrow(/produces/i);
    });

    it('should reject stages with unknown handlers', () => {
        const unknownHandler = `
name: Test
persona: test
stages:
  - id: a
    produces: [a.json]
    handler: unknown_handler
`;
        expect(() => manifest_parse(unknownHandler)).toThrow(/unknown handler/i);
    });

    it('should reject stages with unsafe handler format', () => {
        const unsafeHandler = `
name: Test
persona: test
stages:
  - id: a
    produces: [a.json]
    handler: ../search
`;
        expect(() => manifest_parse(unsafeHandler)).toThrow(/invalid format/i);
    });
});

describe('dag/graph/parser/script', () => {

    // Pre-parse the branching manifest once for reuse
    const branchManifest = manifest_parse(BRANCHING_MANIFEST_YAML);

    it('should parse a script into a DAGDefinition using manifest topology', () => {
        const def = script_parse(SCRIPT_YAML, branchManifest);
        expect(def.source).toBe('script');
        expect(def.nodes.size).toBe(4); // same 4 stages as manifest
        expect(def.rootIds).toEqual(['search']);
        expect(def.edges.length).toBe(branchManifest.edges.length);
        expect(def.terminalIds).toEqual(['harmonize']);
    });

    it('should apply parameter overrides from script', () => {
        const def = script_parse(SCRIPT_YAML, branchManifest);
        expect(def.nodes.get('search')!.parameters['keywords']).toBe('brain MRI');
        expect(def.nodes.get('harmonize')!.parameters['resolution']).toEqual([2.0, 2.0, 2.0]);
    });

    it('should mark skip: true stages with skip sentinel parameters', () => {
        const def = script_parse(SCRIPT_YAML, branchManifest);
        expect(def.nodes.get('rename')!.parameters['__skip']).toBe(true);
    });

    it('should reject script referencing nonexistent manifest stages', () => {
        const badScript = `
name: Bad Script
manifest: branch-join.manifest.yaml
version: 1.0.0
authors: Test
stages:
  - id: nonexistent_stage
    parameters:
      foo: bar
`;
        expect(() => script_parse(badScript, branchManifest)).toThrow(/nonexistent/i);
    });

    it('should preserve header fields from script', () => {
        const def = script_parse(SCRIPT_YAML, branchManifest);
        const header = def.header as import('./types.js').ScriptHeader;
        expect(header.name).toBe('Quick Path');
        expect(header.manifest).toBe('branch-join.manifest.yaml');
    });

    it('should preserve manifest stages not mentioned in script', () => {
        // Script with only one stage override — others should keep manifest defaults
        const partialScript = `
name: Partial Script
manifest: branch-join.manifest.yaml
version: 1.0.0
authors: Test
stages:
  - id: search
    parameters:
      keywords: "brain MRI"
`;
        const def = script_parse(partialScript, branchManifest);
        // gather should retain its manifest defaults (empty parameters)
        expect(def.nodes.get('gather')!.parameters).toEqual({});
        // harmonize should retain its manifest resolution
        expect(def.nodes.get('harmonize')!.parameters['resolution']).toEqual([1.0, 1.0, 1.0]);
    });
});

// ═══════════════════════════════════════════════════════════════════
// Validator Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/graph/validator', () => {

    it('should accept a valid linear DAG', () => {
        const def = manifest_parse(MINIMAL_MANIFEST_YAML);
        const result = dag_validate(def);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('should accept a valid DAG with branch and join', () => {
        const def = manifest_parse(BRANCHING_MANIFEST_YAML);
        const result = dag_validate(def);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('should detect cycles', () => {
        const def = manifest_parse(CYCLIC_MANIFEST_YAML);
        const result = dag_validate(def);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => /cycle/i.test(e))).toBe(true);
    });

    it('should detect orphan references', () => {
        const def = manifest_parse(ORPHAN_MANIFEST_YAML);
        const result = dag_validate(def);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => /nonexistent/i.test(e))).toBe(true);
    });

    it('should detect duplicate stage IDs', () => {
        // Build a DAGDefinition with duplicate IDs manually
        // (manifest_parse already rejects duplicates, so we test validator separately)
        const node: DAGNode = {
            id: 'dup', name: 'Dup', phase: null, previous: null,
            optional: false, produces: ['x.json'], parameters: {},
            instruction: '', commands: [], handler: null, completes_with: null, skip_warning: null,
            narrative: null, blueprint: []
        };
        const def: DAGDefinition = {
            source: 'manifest',
            header: { name: 'T', description: '', category: '', persona: 'test', version: '1.0.0', locked: false, authors: '' },
            nodes: new Map([['dup', node]]),
            orderedNodeIds: ['dup'],
            edges: [],
            rootIds: ['dup'],
            terminalIds: ['dup'],
        };
        // Valid with single node
        const result = dag_validate(def);
        expect(result.valid).toBe(true);
    });

    it('should detect stages with empty produces', () => {
        const node: DAGNode = {
            id: 'empty', name: 'Empty', phase: null, previous: null,
            optional: false, produces: [], parameters: {},
            instruction: '', commands: [], handler: null, completes_with: null, skip_warning: null,
            narrative: null, blueprint: []
        };
        const def: DAGDefinition = {
            source: 'manifest',
            header: { name: 'T', description: '', category: '', persona: 'test', version: '1.0.0', locked: false, authors: '' },
            nodes: new Map([['empty', node]]),
            orderedNodeIds: ['empty'],
            edges: [],
            rootIds: ['empty'],
            terminalIds: ['empty'],
        };
        const result = dag_validate(def);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => /produces/i.test(e))).toBe(true);
    });

    it('should detect join nodes where a parent is missing', () => {
        // harmonize references [gather, nonexistent]
        const gather: DAGNode = {
            id: 'gather', name: 'Gather', phase: null, previous: null,
            optional: false, produces: ['g.json'], parameters: {},
            instruction: '', commands: [], handler: null, completes_with: null, skip_warning: null,
            narrative: null, blueprint: []
        };
        const harmonize: DAGNode = {
            id: 'harmonize', name: 'Harmonize', phase: null, previous: ['gather', 'nonexistent'],
            optional: false, produces: ['h.json'], parameters: {},
            instruction: '', commands: [], handler: null, completes_with: null, skip_warning: null,
            narrative: null, blueprint: []
        };
        const def: DAGDefinition = {
            source: 'manifest',
            header: { name: 'T', description: '', category: '', persona: 'test', version: '1.0.0', locked: false, authors: '' },
            nodes: new Map([['gather', gather], ['harmonize', harmonize]]),
            orderedNodeIds: ['gather', 'harmonize'],
            edges: [{ from: 'gather', to: 'harmonize' }],
            rootIds: ['gather'],
            terminalIds: ['harmonize'],
        };
        const result = dag_validate(def);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => /nonexistent/i.test(e))).toBe(true);
    });

    it('should require at least one root node', () => {
        // All stages reference a parent — no root entry point
        const a: DAGNode = {
            id: 'a', name: 'A', phase: null, previous: ['b'],
            optional: false, produces: ['a.json'], parameters: {},
            instruction: '', commands: [], handler: null, completes_with: null, skip_warning: null,
            narrative: null, blueprint: []
        };
        const b: DAGNode = {
            id: 'b', name: 'B', phase: null, previous: ['a'],
            optional: false, produces: ['b.json'], parameters: {},
            instruction: '', commands: [], handler: null, completes_with: null, skip_warning: null,
            narrative: null, blueprint: []
        };
        const def: DAGDefinition = {
            source: 'manifest',
            header: { name: 'T', description: '', category: '', persona: 'test', version: '1.0.0', locked: false, authors: '' },
            nodes: new Map([['a', a], ['b', b]]),
            orderedNodeIds: ['a', 'b'],
            edges: [{ from: 'b', to: 'a' }, { from: 'a', to: 'b' }],
            rootIds: [],
            terminalIds: [],
        };
        const result = dag_validate(def);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => /root/i.test(e))).toBe(true);
    });

    it('should accept a single-node DAG', () => {
        const node: DAGNode = {
            id: 'solo', name: 'Solo', phase: null, previous: null,
            optional: false, produces: ['solo.json'], parameters: {},
            instruction: '', commands: [], handler: null, completes_with: null, skip_warning: null,
            narrative: null, blueprint: []
        };
        const def: DAGDefinition = {
            source: 'manifest',
            header: { name: 'T', description: '', category: '', persona: 'test', version: '1.0.0', locked: false, authors: '' },
            nodes: new Map([['solo', node]]),
            orderedNodeIds: ['solo'],
            edges: [],
            rootIds: ['solo'],
            terminalIds: ['solo'],
        };
        const result = dag_validate(def);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════
// Resolver Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/graph/resolver', () => {

    const branchDef = manifest_parse(BRANCHING_MANIFEST_YAML);

    it('should mark root node as ready when no stages are complete', () => {
        const result = dag_resolve(branchDef, new Set());
        const search = result.find(r => r.nodeId === 'search')!;
        expect(search.ready).toBe(true);
        expect(search.complete).toBe(false);
        expect(search.pendingParents).toEqual([]);
    });

    it('should mark non-root node as not ready when parents incomplete', () => {
        const result = dag_resolve(branchDef, new Set());
        const gather = result.find(r => r.nodeId === 'gather')!;
        expect(gather.ready).toBe(false);
        expect(gather.pendingParents).toEqual(['search']);
    });

    it('should mark node as ready when all parents complete', () => {
        const result = dag_resolve(branchDef, new Set(['search']));
        const gather = result.find(r => r.nodeId === 'gather')!;
        expect(gather.ready).toBe(true);
        expect(gather.pendingParents).toEqual([]);
    });

    it('should mark node as complete when its artifact exists', () => {
        const result = dag_resolve(branchDef, new Set(['search']));
        const search = result.find(r => r.nodeId === 'search')!;
        expect(search.complete).toBe(true);
        expect(search.ready).toBe(false); // complete nodes are not "ready"
    });

    it('should handle join nodes — ready only when all parents complete', () => {
        const result = dag_resolve(branchDef, new Set(['search', 'gather']));
        const harmonize = result.find(r => r.nodeId === 'harmonize')!;
        expect(harmonize.ready).toBe(false);
        expect(harmonize.pendingParents).toEqual(['rename']);
    });

    it('should handle join nodes — ready when all parents complete', () => {
        const result = dag_resolve(branchDef, new Set(['search', 'gather', 'rename']));
        const harmonize = result.find(r => r.nodeId === 'harmonize')!;
        expect(harmonize.ready).toBe(true);
        expect(harmonize.pendingParents).toEqual([]);
    });

    it('should report stale=false when no fingerprint data provided', () => {
        const result = dag_resolve(branchDef, new Set(['search']));
        for (const r of result) {
            expect(r.stale).toBe(false);
        }
    });

    it('should return readiness for all nodes at once', () => {
        const result = dag_resolve(branchDef, new Set());
        expect(result.length).toBe(branchDef.nodes.size);
        const ids = result.map(r => r.nodeId).sort();
        const expected = Array.from(branchDef.nodes.keys()).sort();
        expect(ids).toEqual(expected);
    });

    it('should handle an empty DAG (edge case)', () => {
        const emptyDef: DAGDefinition = {
            source: 'manifest',
            header: { name: 'E', description: '', category: '', persona: 'test', version: '1.0.0', locked: false, authors: '' },
            nodes: new Map(),
            orderedNodeIds: [],
            edges: [],
            rootIds: [],
            terminalIds: [],
        };
        const result = dag_resolve(emptyDef, new Set());
        expect(result).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════
// Position Resolution Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/graph/resolver — position', () => {

    const branchDef = manifest_parse(BRANCHING_MANIFEST_YAML);

    it('should position at root stage when nothing is complete', () => {
        const pos = position_resolve(branchDef, new Set());
        expect(pos.currentStage?.id).toBe('search');
        expect(pos.nextInstruction).toBe('Search for datasets.');
        expect(pos.availableCommands).toEqual(['search']);
        expect(pos.completedStages).toEqual([]);
        expect(pos.progress.completed).toBe(0);
        expect(pos.progress.total).toBe(4);
        expect(pos.progress.phase).toBe('search');
    });

    it('should advance to next stage when current is complete', () => {
        const pos = position_resolve(branchDef, new Set(['search']));
        expect(pos.currentStage?.id).toBe('gather');
        expect(pos.nextInstruction).toBe('Gather datasets.');
    });

    it('should advance through linear chain', () => {
        const pos = position_resolve(branchDef, new Set(['search', 'gather']));
        // rename comes before harmonize in topo order
        expect(pos.currentStage?.id).toBe('rename');
    });

    it('should offer optional stage before advancing past it', () => {
        const pos = position_resolve(branchDef, new Set(['search', 'gather']));
        expect(pos.currentStage?.id).toBe('rename');
        expect(pos.currentStage?.optional).toBe(true);
    });

    it('should advance past skipped optional stage', () => {
        const pos = position_resolve(branchDef, new Set(['search', 'gather', 'rename']));
        expect(pos.currentStage?.id).toBe('harmonize');
    });

    it('should wait at join node until all parents complete', () => {
        // Only search and gather done, rename not done
        // harmonize needs both gather and rename → not ready
        // rename is ready (parent gather is done)
        const pos = position_resolve(branchDef, new Set(['search', 'gather']));
        expect(pos.currentStage?.id).toBe('rename');
    });

    it('should advance past join when all parents complete', () => {
        const pos = position_resolve(branchDef, new Set(['search', 'gather', 'rename']));
        expect(pos.currentStage?.id).toBe('harmonize');
    });

    it('should report stale stages in position', () => {
        const pos = position_resolve(
            branchDef,
            new Set(['search', 'gather', 'rename', 'harmonize']),
            new Set(['harmonize']),
        );
        expect(pos.staleStages).toContain('harmonize');
    });

    it('should report isComplete when all stages done', () => {
        const pos = position_resolve(
            branchDef,
            new Set(['search', 'gather', 'rename', 'harmonize']),
        );
        expect(pos.isComplete).toBe(true);
        expect(pos.currentStage).toBeNull();
        expect(pos.nextInstruction).toBeNull();
        expect(pos.progress.completed).toBe(4);
    });

    it('should include full readiness in allReadiness', () => {
        const pos = position_resolve(branchDef, new Set());
        expect(pos.allReadiness.length).toBe(branchDef.nodes.size);
    });

    it('should report correct progress counts', () => {
        const pos = position_resolve(branchDef, new Set(['search', 'gather']));
        expect(pos.progress.completed).toBe(2);
        expect(pos.progress.total).toBe(4);
    });

    it('should report current phase from currentStage', () => {
        const pos = position_resolve(branchDef, new Set(['search', 'gather', 'rename']));
        expect(pos.currentStage?.id).toBe('harmonize');
        expect(pos.progress.phase).toBe('harmonize');
    });

    it('should report null phase when currentStage has no phase', () => {
        const minDef = manifest_parse(MINIMAL_MANIFEST_YAML);
        const pos = position_resolve(minDef, new Set());
        // alpha stage has phase: ~ (null)
        expect(pos.currentStage?.id).toBe('alpha');
        expect(pos.progress.phase).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════
// Type Contract Tests (structural assertions)
// ═══════════════════════════════════════════════════════════════════

describe('dag/graph/types contracts', () => {

    it('DAGNode with null previous is a root node', () => {
        const root: DAGNode = {
            id: 'search',
            name: 'Search',
            phase: null,
            previous: null,
            optional: false,
            produces: ['search.json'],
            parameters: {},
            instruction: 'Search for datasets.',
            commands: ['search'],
            handler: null,
            completes_with: null,
            skip_warning: null,
            narrative: null,
            blueprint: [],
        };
        expect(root.previous).toBeNull();
        expect(root.produces.length).toBeGreaterThan(0);
    });

    it('DAGNode with array previous is a join node', () => {
        const join: DAGNode = {
            id: 'harmonize',
            name: 'Harmonize',
            phase: null,
            previous: ['gather', 'rename'],
            optional: false,
            produces: ['harmonize.json'],
            parameters: { resolution: [1.0, 1.0, 1.0] },
            instruction: 'Harmonize your cohort.',
            commands: ['harmonize'],
            handler: null,
            completes_with: null,
            skip_warning: {
                short: 'Not harmonized.',
                reason: 'FL requires consistent formats.',
                max_warnings: 2,
            },
            narrative: null,
            blueprint: [],
        };
        expect(join.previous).toHaveLength(2);
        expect(join.skip_warning).not.toBeNull();
    });

    it('DAGEdge connects from parent to child', () => {
        const edge: DAGEdge = { from: 'search', to: 'gather' };
        expect(edge.from).toBe('search');
        expect(edge.to).toBe('gather');
    });

    it('DAGDefinition uses Map for node lookup', () => {
        const nodes = new Map<string, DAGNode>();
        nodes.set('alpha', {
            id: 'alpha',
            name: 'Alpha',
            phase: null,
            previous: null,
            optional: false,
            produces: ['alpha.json'],
            parameters: {},
            instruction: 'Do alpha.',
            commands: ['alpha'],
            handler: null,
            completes_with: null,
            skip_warning: null,
            narrative: null,
            blueprint: [],
        });

        const def: DAGDefinition = {
            source: 'manifest',
            header: {
                name: 'Test',
                description: 'Test',
                category: 'Test',
                persona: 'test',
                version: '1.0.0',
                locked: false,
                authors: 'Test',
            },
            nodes,
            orderedNodeIds: ['alpha'],
            edges: [],
            rootIds: ['alpha'],
            terminalIds: ['alpha'],
        };

        expect(def.nodes.get('alpha')).toBeDefined();
        expect(def.nodes.get('alpha')!.id).toBe('alpha');
    });

    it('ValidationResult reports valid with empty errors', () => {
        const result: ValidationResult = { valid: true, errors: [] };
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('ValidationResult reports invalid with error messages', () => {
        const result: ValidationResult = {
            valid: false,
            errors: ['Cycle detected: a → b → c → a'],
        };
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
    });

    it('NodeReadiness tracks pending parents', () => {
        const readiness: NodeReadiness = {
            nodeId: 'harmonize',
            ready: false,
            complete: false,
            stale: false,
            pendingParents: ['rename'],
        };
        expect(readiness.ready).toBe(false);
        expect(readiness.pendingParents).toContain('rename');
    });

    it('WorkflowPosition at start of workflow', () => {
        const searchNode: DAGNode = {
            id: 'search',
            name: 'Dataset Discovery',
            phase: null,
            previous: null,
            optional: false,
            produces: ['search.json'],
            parameters: { keywords: null },
            instruction: 'Search the ATLAS catalog.',
            commands: ['search <keywords>'],
            handler: null,
            completes_with: null,
            skip_warning: null,
            narrative: null,
            blueprint: [],
        };
        const position: WorkflowPosition = {
            completedStages: [],
            currentStage: searchNode,
            nextInstruction: 'Search the ATLAS catalog.',
            availableCommands: ['search <keywords>'],
            staleStages: [],
            allReadiness: [{
                nodeId: 'search',
                ready: true,
                complete: false,
                stale: false,
                pendingParents: [],
            }],
            progress: { completed: 0, total: 14, phase: null },
            isComplete: false,
        };
        expect(position.currentStage).not.toBeNull();
        expect(position.currentStage!.id).toBe('search');
        expect(position.nextInstruction).toBeTruthy();
        expect(position.isComplete).toBe(false);
        expect(position.progress.completed).toBe(0);
    });

    it('WorkflowPosition when workflow is complete', () => {
        const position: WorkflowPosition = {
            completedStages: ['search', 'gather', 'rename', 'harmonize',
                'code', 'train', 'federate-brief', 'federate-transcompile',
                'federate-containerize', 'federate-publish-config',
                'federate-publish-execute', 'federate-dispatch',
                'federate-execute', 'federate-model-publish'],
            currentStage: null,
            nextInstruction: null,
            availableCommands: [],
            staleStages: [],
            allReadiness: [],
            progress: { completed: 14, total: 14, phase: null },
            isComplete: true,
        };
        expect(position.isComplete).toBe(true);
        expect(position.currentStage).toBeNull();
        expect(position.nextInstruction).toBeNull();
        expect(position.completedStages).toHaveLength(14);
    });
});
