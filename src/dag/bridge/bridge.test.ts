/**
 * @file Bridge Layer Tests
 *
 * Tests for CompletionMapper and WorkflowAdapter — the bridge between
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
    vfs.file_create(filePath, JSON.stringify({
        stage: stageId,
        timestamp: new Date().toISOString(),
        parameters_used: {},
        content: {},
        _fingerprint: '',
        _parent_fingerprints: {},
    }));
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
// CompletionMapper Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/bridge/CompletionMapper — fedml', () => {
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
        // rename is optional, completes_with gather
        expect(pos.completedStages).toContain('rename');
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

    it('should detect federation completion from session artifact', () => {
        const vfs = vfs_create(['search', 'gather', 'harmonize', 'code', 'train', 'federate-brief'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        // All federation sub-stages alias to federate-brief
        expect(pos.completedStages).toContain('federate-brief');
        expect(pos.completedStages).toContain('federate-transcompile');
        expect(pos.completedStages).toContain('federate-model-publish');
    });

    it('should report all 14 stages complete when core artifacts exist', () => {
        const vfs = vfs_create(['search', 'gather', 'harmonize', 'code', 'train', 'federate-brief'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.completedStages.length).toBe(14);
    });
});

const CHRIS_SESSION = '/home/test/sessions/chris/session-test';

describe('dag/bridge/CompletionMapper — chris', () => {
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
                vfs.file_create(filePath, JSON.stringify({}));
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

    it('should never auto-complete publish (action stage)', () => {
        const vfs = chris_vfs_create(['gather', 'code', 'test', 'publish']);
        const pos = adapter.position_resolve(vfs, CHRIS_SESSION);
        expect(pos.completedStages).toContain('test');
        expect(pos.completedStages).not.toContain('publish');
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

    it('should advance to harmonize after gather completes', () => {
        const vfs = vfs_create(['search', 'gather'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('harmonize');
    });

    it('should advance to code after harmonize completes', () => {
        const vfs = vfs_create(['search', 'gather', 'harmonize'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('code');
    });

    it('should advance to train after code completes', () => {
        const vfs = vfs_create(['search', 'gather', 'harmonize', 'code'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('train');
    });

    it('should advance to federate-brief after train completes', () => {
        const vfs = vfs_create(['search', 'gather', 'harmonize', 'code', 'train'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('federate-brief');
    });

    it('should report isComplete when all stages done', () => {
        const vfs = vfs_create(['search', 'gather', 'harmonize', 'code', 'train', 'federate-brief'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.isComplete).toBe(true);
        expect(pos.currentStage).toBeNull();
    });

    it('should provide instruction and commands from manifest', () => {
        const vfs = vfs_create(['search', 'gather'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        // harmonize stage
        expect(pos.nextInstruction).toBeTruthy();
        expect(pos.nextInstruction).toContain('Harmonize');
        expect(pos.availableCommands).toContain('harmonize');
    });
});

describe('dag/bridge/WorkflowAdapter — transitions', () => {
    const adapter = WorkflowAdapter.definition_load('fedml');
    const sp = adapter.stagePaths;

    it('should allow command when deps are satisfied', () => {
        const vfs = vfs_create(['search', 'gather'], sp);
        const result = adapter.transition_check('harmonize', vfs, SESSION);
        expect(result.allowed).toBe(true);
    });

    it('should warn when skipping harmonize to code', () => {
        const vfs = vfs_create(['search', 'gather'], sp);
        const result = adapter.transition_check('proceed', vfs, SESSION);
        expect(result.allowed).toBe(false);
        expect(result.warning).toContain('Cohort not harmonized');
    });

    it('should allow after max warnings exceeded', () => {
        const vfs = vfs_create(['search', 'gather'], sp);
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
        expect(summary).toContain('Progress: 3/14'); // search + rename + gather
        expect(summary).toContain('● Dataset Discovery');
        expect(summary).toContain('● Project Rename'); // aliased to gather
        expect(summary).toContain('● Cohort Assembly');
        expect(summary).toContain('○ Data Harmonization ← NEXT');
    });
});
