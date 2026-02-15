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
        const vfs = vfs_create(['gather'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        // gather artifact also resolves search (subsumed) and rename (optional)
        expect(pos.completedStages).toContain('gather');
        expect(pos.completedStages).toContain('search');
        expect(pos.completedStages).toContain('rename');
    });

    it('should detect harmonize completion from session artifact', () => {
        const vfs = vfs_create(['gather', 'harmonize'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.completedStages).toContain('harmonize');
    });

    it('should detect code completion from session artifact', () => {
        const vfs = vfs_create(['gather', 'harmonize', 'code'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.completedStages).toContain('code');
    });

    it('should detect train completion from session artifact', () => {
        const vfs = vfs_create(['gather', 'harmonize', 'code', 'train'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.completedStages).toContain('train');
    });

    it('should detect federation completion from session artifact', () => {
        const vfs = vfs_create(['gather', 'harmonize', 'code', 'train', 'federate-brief'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        // All federation sub-stages alias to federate-brief
        expect(pos.completedStages).toContain('federate-brief');
        expect(pos.completedStages).toContain('federate-transcompile');
        expect(pos.completedStages).toContain('federate-model-publish');
    });

    it('should report all 14 stages complete when core artifacts exist', () => {
        const vfs = vfs_create(['gather', 'harmonize', 'code', 'train', 'federate-brief'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.completedStages.length).toBe(14);
    });
});

describe('dag/bridge/CompletionMapper — chris', () => {
    const adapter = WorkflowAdapter.definition_load('chris');
    const sp = adapter.stagePaths;
    const CHRIS_SESSION = '/home/test/sessions/chris/session-test';

    function chris_vfs_create(stageIds: string[]): VirtualFileSystem {
        const vfs = new VirtualFileSystem('test');
        vfs.dir_create(`${CHRIS_SESSION}/data`);
        for (const id of stageIds) {
            const path = sp.get(id);
            if (path) {
                vfs.dir_create(`${CHRIS_SESSION}/${path.dataDir}`);
                vfs.file_create(`${CHRIS_SESSION}/${path.artifactFile}`, '{}');
            }
        }
        return vfs;
    }

    it('should return empty set when no artifacts exist', () => {
        const vfs = chris_vfs_create([]);
        const pos = adapter.position_resolve(vfs, CHRIS_SESSION);
        expect(pos.completedStages.length).toBe(0);
    });

    it('should detect gather and code completion', () => {
        const vfs = chris_vfs_create(['gather', 'code']);
        const pos = adapter.position_resolve(vfs, CHRIS_SESSION);
        expect(pos.completedStages).toContain('gather');
        expect(pos.completedStages).toContain('code');
        expect(pos.completedStages).not.toContain('test');
    });

    it('should never auto-complete publish (action stage)', () => {
        const vfs = chris_vfs_create(['gather', 'code', 'test']);
        const pos = adapter.position_resolve(vfs, CHRIS_SESSION);
        expect(pos.completedStages).not.toContain('publish');
    });
});

// ═══════════════════════════════════════════════════════════════════
// WorkflowAdapter Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/bridge/WorkflowAdapter', () => {

    it('should load fedml workflow from manifest', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        expect(adapter.workflowId).toBe('fedml');
    });

    it('should load chris workflow from manifest', () => {
        const adapter = WorkflowAdapter.definition_load('chris');
        expect(adapter.workflowId).toBe('chris');
    });

    it('should throw on unknown workflow', () => {
        expect(() => WorkflowAdapter.definition_load('unknown')).toThrow(/not found/i);
    });

    it('should list available workflows', () => {
        const ids = WorkflowAdapter.workflows_list();
        expect(ids).toContain('fedml');
        expect(ids).toContain('chris');
    });

    it('should summarize available workflows', () => {
        const summaries = WorkflowAdapter.workflows_summarize();
        expect(summaries.length).toBe(2);
        const fedml = summaries.find(s => s.id === 'fedml');
        expect(fedml).toBeDefined();
        expect(fedml!.persona).toBe('fedml');
        expect(fedml!.stageCount).toBe(14);
    });

    it('should compute topology-aware stage paths', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sp = adapter.stagePaths;

        // Root stage
        expect(sp.get('search')?.artifactFile).toBe('data/search.json');

        // First level under root
        expect(sp.get('gather')?.artifactFile).toBe('gather/data/gather.json');

        // Nested under gather
        expect(sp.get('rename')?.artifactFile).toBe('gather/rename/data/rename.json');
        expect(sp.get('harmonize')?.artifactFile).toBe('gather/harmonize/data/harmonize.json');

        // Deep nesting follows DAG topology
        expect(sp.get('code')?.artifactFile).toBe('gather/harmonize/code/data/code.json');
        expect(sp.get('train')?.artifactFile).toBe('gather/harmonize/code/train/data/train.json');
        expect(sp.get('federate-brief')?.artifactFile).toContain('train/federate-brief/data/federate-brief.json');
    });
});

describe('dag/bridge/WorkflowAdapter — position', () => {
    const adapter = WorkflowAdapter.definition_load('fedml');
    const sp = adapter.stagePaths;

    it('should position at first stage when nothing is complete', () => {
        const vfs = vfs_create([], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('search');
        expect(pos.completedStages).toEqual([]);
        expect(pos.progress.completed).toBe(0);
        expect(pos.progress.total).toBe(14);
        expect(pos.isComplete).toBe(false);
    });

    it('should advance to harmonize after gather completes', () => {
        const vfs = vfs_create(['gather'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('harmonize');
    });

    it('should advance to code after harmonize completes', () => {
        const vfs = vfs_create(['gather', 'harmonize'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('code');
    });

    it('should advance to train after code completes', () => {
        const vfs = vfs_create(['gather', 'harmonize', 'code'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('train');
    });

    it('should advance to federate-brief after train completes', () => {
        const vfs = vfs_create(['gather', 'harmonize', 'code', 'train'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.currentStage?.id).toBe('federate-brief');
    });

    it('should report isComplete when all stages done', () => {
        const vfs = vfs_create(['gather', 'harmonize', 'code', 'train', 'federate-brief'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        expect(pos.isComplete).toBe(true);
        expect(pos.currentStage).toBeNull();
    });

    it('should provide instruction and commands from manifest', () => {
        const vfs = vfs_create(['gather'], sp);
        const pos = adapter.position_resolve(vfs, SESSION);
        // harmonize stage
        expect(pos.nextInstruction).toBeTruthy();
        expect(pos.nextInstruction).toContain('Harmonize');
        expect(pos.availableCommands).toContain('harmonize');
    });
});

describe('dag/bridge/WorkflowAdapter — transition', () => {
    const sp = WorkflowAdapter.definition_load('fedml').stagePaths;

    it('should allow command when deps are satisfied', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        const vfs = vfs_create(['gather'], sp);
        const result = adapter.transition_check('harmonize', vfs, SESSION);
        expect(result.allowed).toBe(true);
    });

    it('should warn when skipping harmonize to code', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        const vfs = vfs_create(['gather'], sp);
        const result = adapter.transition_check('proceed', vfs, SESSION);
        expect(result.allowed).toBe(false);
        expect(result.warning).toContain('harmonized');
        expect(result.skippedStageId).toBe('harmonize');
    });

    it('should allow after max warnings exceeded', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        const vfs = vfs_create(['gather'], sp);

        // First attempt — warning
        let result = adapter.transition_check('proceed', vfs, SESSION);
        expect(result.allowed).toBe(false);
        adapter.skip_increment(result.skippedStageId!);

        // Second attempt — warning with reason
        result = adapter.transition_check('proceed', vfs, SESSION);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBeTruthy();
        adapter.skip_increment(result.skippedStageId!);

        // Third attempt — allowed (max_warnings=2 exceeded)
        result = adapter.transition_check('proceed', vfs, SESSION);
        expect(result.allowed).toBe(true);
    });

    it('should allow unknown commands (not workflow-controlled)', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        const vfs = vfs_create([], sp);
        const result = adapter.transition_check('ls', vfs, SESSION);
        expect(result.allowed).toBe(true);
    });

    it('should allow already-completed stage', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        const vfs = vfs_create(['gather'], sp);
        const result = adapter.transition_check('gather', vfs, SESSION);
        expect(result.allowed).toBe(true);
    });
});

describe('dag/bridge/WorkflowAdapter — stage lookup', () => {

    it('should find stage by command', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        const node = adapter.stage_forCommand('harmonize');
        expect(node?.id).toBe('harmonize');
    });

    it('should find stage by compound command', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        const node = adapter.stage_forCommand('search brain MRI');
        expect(node?.id).toBe('search');
    });

    it('should return null for unknown command', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        const node = adapter.stage_forCommand('ls');
        expect(node).toBeNull();
    });
});

describe('dag/bridge/WorkflowAdapter — skip management', () => {

    it('should increment skip count', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        expect(adapter.skip_increment('harmonize')).toBe(1);
        expect(adapter.skip_increment('harmonize')).toBe(2);
    });

    it('should clear skip count on stage complete', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        adapter.skip_increment('harmonize');
        adapter.skip_increment('harmonize');
        adapter.stage_complete('harmonize');
        expect(adapter.skip_increment('harmonize')).toBe(1);
    });
});

describe('dag/bridge/WorkflowAdapter — progress', () => {

    it('should summarize progress', () => {
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sp = adapter.stagePaths;
        const vfs = vfs_create(['gather'], sp);
        const summary = adapter.progress_summarize(vfs, SESSION);
        expect(summary).toContain('Federated ML');
        expect(summary).toContain('●'); // completed marker
        expect(summary).toContain('○'); // pending marker
        expect(summary).toContain('NEXT');
    });
});
