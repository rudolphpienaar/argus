/**
 * @file Bridge Layer Tests
 *
 * Tests for completion resolution and WorkflowAdapter — the bridge between
 * the DAG engine and CalypsoCore.
 *
 * Completion is checked against session tree artifacts at topology-aware
 * paths that mirror the DAG structure:
 *   session-root/gather/harmonize/code/train/data/train.json
 *
 * @module dag/bridge
 */

import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { WorkflowAdapter } from './WorkflowAdapter.js';
import type { StagePath } from './SessionPaths.js';

// ═══════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════

const SESSION = '/home/test/sessions/fedml/session-test';

/**
 * Create a minimal valid artifact envelope for adapter completion checks.
 *
 * WorkflowAdapter now requires truthy `_fingerprint` and `_parent_fingerprints`
 * fields when reading materialized artifacts.
 */
function envelope_create(
    stageId: string,
    options: {
        fingerprint?: string;
        parentFingerprints?: Record<string, string>;
        timestamp?: string;
    } = {},
): string {
    return JSON.stringify({
        stage: stageId,
        timestamp: options.timestamp ?? new Date().toISOString(),
        parameters_used: {},
        content: {},
        _fingerprint: options.fingerprint ?? `fp-${stageId}`,
        _parent_fingerprints: options.parentFingerprints ?? {},
    });
}

/**
 * Write a session artifact at the topology-aware path for a stage.
 * Uses the WorkflowAdapter's stagePaths to resolve the correct location.
 */
function artifact_write(
    vfs: VirtualFileSystem,
    stageId: string,
    stagePaths: Map<string, StagePath>,
): void {
    const sp = stagePaths.get(stageId);
    if (!sp) throw new Error(`No stage path for ${stageId}`);

    const dataDir = `${SESSION}/${sp.dataDir}`;
    const filePath = `${SESSION}/${sp.artifactFile}`;
    vfs.dir_create(dataDir);
    vfs.file_create(filePath, envelope_create(stageId));
}

/**
 * Write a custom artifact envelope at an explicit session-relative path.
 */
function artifact_writeAt(
    vfs: VirtualFileSystem,
    relativePath: string,
    stageId: string,
    options: {
        fingerprint?: string;
        parentFingerprints?: Record<string, string>;
        timestamp?: string;
    } = {},
): void {
    const fullPath = `${SESSION}/${relativePath}`;
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    vfs.dir_create(dir);
    vfs.file_create(fullPath, envelope_create(stageId, options));
}

/**
 * Create a VFS with session artifacts for the given stage IDs.
 * Writes at topology-aware paths derived from the adapter's DAG.
 */
function vfs_create(
    stageIds: string[],
    stagePaths: Map<string, StagePath>,
): VirtualFileSystem {
    const vfs = new VirtualFileSystem('test');
    
    // root 'data' dir for search artifact
    vfs.dir_create(`${SESSION}/data`);

    for (const id of stageIds) {
        artifact_write(vfs, id, stagePaths);
    }

    return vfs;
}

// ═══════════════════════════════════════════════════════════════════
// Completion Resolution Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/bridge/completion resolution — fedml', () => {
    const adapter = WorkflowAdapter.definition_load('fedml');
    const sp = adapter.stagePaths;

    it('should return empty set when no artifacts exist', () => {
        const vfs = vfs_create([], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.completedStages).toEqual([]);
    });

    it('should detect gather completion from session artifact', () => {
        // Now requires search to be complete too
        const vfs = vfs_create(['search', 'gather'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.completedStages).toContain('gather');
        expect(pos.completedStages).toContain('search');
        // v10.2.1: rename no longer auto-completes through stage-alias semantics.
        // It requires its own artifact or skip sentinel.
        expect(pos.completedStages).not.toContain('rename');
    });

    it('should detect harmonize completion from session artifact', () => {
        const vfs = vfs_create(['search', 'gather', 'harmonize'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.completedStages).toContain('harmonize');
    });

    it('should detect code completion from session artifact', () => {
        const vfs = vfs_create(['search', 'gather', 'harmonize', 'code'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.completedStages).toContain('code');
    });

    it('should detect train completion from session artifact', () => {
        const vfs = vfs_create(['search', 'gather', 'harmonize', 'code', 'train'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.completedStages).toContain('train');
    });

    it('should detect only the completed federation stage from session artifact', () => {
        const vfs = vfs_create(['search', 'gather', 'harmonize', 'code', 'train', 'federate-brief'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        // Federation stages are distinct in the manifest; only federate-brief
        // is complete here.
        expect(pos.completedStages).toContain('federate-brief');
        expect(pos.completedStages).not.toContain('federate-transcompile');
        expect(pos.completedStages).not.toContain('federate-model-publish');
    });

    it('should report 6 stages complete for the seeded artifact set', () => {
        const vfs = vfs_create(['search', 'gather', 'harmonize', 'code', 'train', 'federate-brief'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        // search, gather, harmonize, code, train, federate-brief (rename NOT counted)
        expect(pos.completedStages.length).toBe(6);
    });
});

const CHRIS_SESSION = '/home/test/sessions/chris/session-test';

describe('dag/bridge/completion resolution — chris', () => {
    const adapter = WorkflowAdapter.definition_load('chris');
    const sp = adapter.stagePaths;

    function chris_vfs_create(stageIds: string[]): VirtualFileSystem {
        const vfs = new VirtualFileSystem('test');
        for (const id of stageIds) {
            const path = sp.get(id);
            if (path) {
                const dataDir = `${CHRIS_SESSION}/${path.dataDir}`;
                const filePath = `${CHRIS_SESSION}/${path.artifactFile}`;
                vfs.dir_create(dataDir);
                vfs.file_create(filePath, envelope_create(id));
            }
        }
        return vfs;
    }

    it('should return empty set when no artifacts exist', () => {
        const vfs = chris_vfs_create([]);
        const pos = adapter.position_resolve(vfs, CHRIS_SESSION);
        expect(pos.completedStages).toEqual([]);
    });

    it('should detect gather and code completion', () => {
        const vfs = chris_vfs_create(['gather', 'code']);
        const pos = adapter.position_resolve(vfs, CHRIS_SESSION);
        expect(pos.completedStages).toContain('gather');
        expect(pos.completedStages).toContain('code');
        expect(pos.completedStages).not.toContain('test');
    });

    it('should mark publish complete when publish artifact exists', () => {
        const vfs = chris_vfs_create(['gather', 'code', 'test', 'publish']);
        const pos = adapter.position_resolve(vfs, CHRIS_SESSION);
        expect(pos.completedStages).toContain('test');
        expect(pos.completedStages).toContain('publish');
    });
});

// ═══════════════════════════════════════════════════════════════════
// WorkflowAdapter Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/bridge/WorkflowAdapter — position', () => {
    const adapter = WorkflowAdapter.definition_load('fedml');
    const sp = adapter.stagePaths;

    it('should position at first stage when nothing is complete', () => {
        const vfs = vfs_create([], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('search');
        expect(pos.isComplete).toBe(false);
    });

    it('should advance to rename (optional) after gather completes', () => {
        // v10.2.1: Position stops at rename (first ready-but-incomplete node)
        // because rename no longer auto-completes through stage-alias semantics.
        const vfs = vfs_create(['search', 'gather'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('rename');
    });

    it('should advance to harmonize after gather + rename complete', () => {
        const vfs = vfs_create(['search', 'gather', 'rename'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('harmonize');
    });

    it('should advance to code after harmonize completes', () => {
        const vfs = vfs_create(['search', 'gather', 'rename', 'harmonize'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('code');
    });

    it('should advance to train after code completes', () => {
        const vfs = vfs_create(['search', 'gather', 'rename', 'harmonize', 'code'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('train');
    });

    it('should advance to federate-brief after train completes', () => {
        const vfs = vfs_create(['search', 'gather', 'rename', 'harmonize', 'code', 'train'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('federate-brief');
    });

    it('should remain incomplete when only federate-brief is complete', () => {
        const vfs = vfs_create(['search', 'gather', 'rename', 'harmonize', 'code', 'train', 'federate-brief'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.isComplete).toBe(false);
        expect(pos.currentStage?.id).toBe('federate-transcompile');
    });

    it('should provide instruction and commands from manifest', () => {
        const vfs = vfs_create(['search', 'gather'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        // v10.2.1: Position is at rename (optional), not harmonize
        expect(pos.nextInstruction).toBeTruthy();
        expect(pos.nextInstruction).toContain('Rename');
        expect(pos.availableCommands).toContain('rename <new-name>');
    });
});

describe('dag/bridge/WorkflowAdapter — transitions', () => {
    const adapter = WorkflowAdapter.definition_load('fedml');
    const sp = adapter.stagePaths;

    it('should allow harmonize when deps are satisfied (including rename)', () => {
        const vfs = vfs_create(['search', 'gather', 'rename'], sp);
        const result = adapter.transition_check('harmonize', vfs, SESSION);
        expect(result.allowed).toBe(true);
    });

    it('should signal auto-declinable optionals when rename is pending', () => {
        // v10.2.1: harmonize has pending optional parent (rename).
        // transition_check returns autoDeclinable so CalypsoCore can
        // materialize a skip sentinel.
        const vfs = vfs_create(['search', 'gather'], sp);
        const result = adapter.transition_check('harmonize', vfs, SESSION);
        expect(result.allowed).toBe(false);
        expect(result.autoDeclinable).toBe(true);
        expect(result.pendingOptionals).toContain('rename');
    });

    it('should warn when skipping harmonize to code', () => {
        const vfs = vfs_create(['search', 'gather', 'rename'], sp);
        const result = adapter.transition_check('proceed', vfs, SESSION);
        expect(result.allowed).toBe(false);
        expect(result.warning).toContain('Cohort not harmonized');
    });

    it('should allow after max warnings exceeded', () => {
        const vfs = vfs_create(['search', 'gather', 'rename'], sp);
        adapter.skip_increment('harmonize');
        adapter.skip_increment('harmonize');
        const result = adapter.transition_check('proceed', vfs, SESSION);
        expect(result.allowed).toBe(true);
    });

    it('should allow unknown commands (not workflow-controlled)', () => {
        const vfs = vfs_create([], sp);
        const result = adapter.transition_check('ls', vfs, SESSION);
        expect(result.allowed).toBe(true);
    });

    it('should allow already-completed stage', () => {
        const vfs = vfs_create(['search', 'gather'], sp);
        const result = adapter.transition_check('gather', vfs, SESSION);
        expect(result.allowed).toBe(true);
    });

    it('should allow transitions when prerequisites exist only in join-materialized paths', () => {
        const vfs = new VirtualFileSystem('test');
        artifact_write(vfs, 'search', sp);
        artifact_write(vfs, 'gather', sp);
        artifact_write(vfs, 'rename', sp);
        artifact_writeAt(
            vfs,
            'search/gather/rename/_join_gather_rename/harmonize/data/harmonize.json',
            'harmonize',
        );

        const result = adapter.transition_check('proceed', vfs, SESSION);
        expect(result.allowed).toBe(true);
    });

    it('should allow transitions from legacy primary-parent layout (read compatibility)', () => {
        const vfs = new VirtualFileSystem('test');
        artifact_writeAt(vfs, 'search/data/search.json', 'search');
        artifact_writeAt(vfs, 'search/gather/data/gather.json', 'gather');
        artifact_writeAt(vfs, 'search/gather/harmonize/data/harmonize.json', 'harmonize');

        const result = adapter.transition_check('proceed', vfs, SESSION);
        expect(result.allowed).toBe(true);
    });

    it('should hard-block with stale flag when parent prerequisites are stale', () => {
        const vfs = new VirtualFileSystem('test');
        artifact_writeAt(vfs, 'search/data/search.json', 'search', {
            fingerprint: 'fp-search-v1',
            timestamp: '2026-02-18T10:00:00.000Z',
        });
        artifact_writeAt(vfs, 'search/gather/data/gather.json', 'gather', {
            fingerprint: 'fp-gather-v1',
            parentFingerprints: { search: 'fp-search-v1' },
            timestamp: '2026-02-18T10:01:00.000Z',
        });
        artifact_writeAt(vfs, 'search/gather/harmonize/data/harmonize.json', 'harmonize', {
            fingerprint: 'fp-harmonize-v1',
            parentFingerprints: { gather: 'fp-gather-v1' },
            timestamp: '2026-02-18T10:02:00.000Z',
        });
        // Re-execute search with a new fingerprint; gather and downstream become stale.
        artifact_writeAt(vfs, 'search/data/search_BRANCH_2/data/search.json', 'search', {
            fingerprint: 'fp-search-v2',
            timestamp: '2026-02-18T10:03:00.000Z',
        });

        const result = adapter.transition_check('proceed', vfs, SESSION);
        expect(result.allowed).toBe(false);
        expect(result.hardBlock).toBe(true);
        expect(result.staleBlock).toBe(true);
        expect(result.warning).toContain('STALE PREREQUISITE');
    });
});

describe('dag/bridge/WorkflowAdapter — lookup', () => {
    const adapter = WorkflowAdapter.definition_load('fedml');

    it('should find stage by command', () => {
        const stage = adapter.stage_forCommand('harmonize');
        expect(stage?.id).toBe('harmonize');
    });

    it('should find stage by compound command', () => {
        const stage = adapter.stage_forCommand('search histology');
        expect(stage?.id).toBe('search');
    });

    it('should return null for unknown command', () => {
        const stage = adapter.stage_forCommand('exit');
        expect(stage).toBeNull();
    });

    it('should classify explicit manifest command phrases', () => {
        expect(adapter.commandDeclared_isExplicit('harmonize')).toBe(true);
        expect(adapter.commandDeclared_isExplicit('show container')).toBe(true);
        expect(adapter.commandDeclared_isExplicit('config name oracle-app')).toBe(true);
    });

    it('should reject ambiguous non-explicit command bases', () => {
        expect(adapter.commandDeclared_isExplicit('show')).toBe(false);
        expect(adapter.commandDeclared_isExplicit('config')).toBe(false);
        expect(adapter.commandDeclared_isExplicit('approve')).toBe(false);
    });
});

describe('dag/bridge/WorkflowAdapter — skip management', () => {
    const adapter = WorkflowAdapter.definition_load('fedml');

    it('should increment skip count', () => {
        const count = adapter.skip_increment('harmonize');
        expect(count).toBe(1);
        expect(adapter.skip_increment('harmonize')).toBe(2);
    });

    it('should clear skip count on stage complete', () => {
        adapter.skip_increment('harmonize');
        adapter.stage_complete('harmonize');
        expect(adapter.skip_increment('harmonize')).toBe(1);
    });
});

describe('dag/bridge/WorkflowAdapter — progress', () => {
    const adapter = WorkflowAdapter.definition_load('fedml');
    const sp = adapter.stagePaths;

    it('should summarize progress', () => {
        const vfs = vfs_create(['search', 'gather'], sp);
        const summary = adapter.progress_summarize(vfs, SESSION);
        // v10.2.1: rename no longer auto-completes; position is at rename
        expect(summary).toContain('Progress: 2/14'); // search + gather only
        expect(summary).toContain('● Dataset Discovery');
        expect(summary).toContain('○ Project Rename ← NEXT');
        expect(summary).toContain('● Cohort Assembly');
        expect(summary).toContain('○ Data Harmonization');
    });
});
