import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import { MerkleEngine } from './MerkleEngine.js';

describe('lcarslm/MerkleEngine runtime materialization scaffolding', () => {
    it('uses store behavior by default and ignores optional parents for nesting', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-default';
        const engine = new MerkleEngine(vfs, adapter, sessionPath);

        await engine.artifact_materialize('search', { query: 'histology' });
        await engine.artifact_materialize('gather', { selected: ['ds-006'] });
        await engine.artifact_materialize('rename', { name: 'proj-a' });
        await engine.artifact_materialize('harmonize', { normalized: true });

        const joinPath = `${sessionPath}/search/gather/rename/_join_gather_rename/harmonize/meta/harmonize.json`;
        expect(vfs.node_stat(joinPath)).toBeNull();
        expect(vfs.node_stat(`${sessionPath}/search/gather/harmonize/meta/harmonize.json`)).toBeTruthy();
    });

    it('can route writes through SessionStore while preserving runtime layout', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-store';
        const engine = new MerkleEngine(vfs, adapter, sessionPath);

        await engine.artifact_materialize('search', { query: 'ct lung' });
        await engine.artifact_materialize('gather', { selected: ['ds-001'] });

        expect(vfs.node_stat(`${sessionPath}/search/meta/search.json`)).toBeTruthy();
        expect(vfs.node_stat(`${sessionPath}/search/gather/meta/gather.json`)).toBeTruthy();
    });

    it('updates root stages in place on re-execution in store mode', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-store-branch';
        const engine = new MerkleEngine(vfs, adapter, sessionPath);

        await engine.artifact_materialize('search', { query: 'mri' });
        await engine.artifact_materialize('search', { query: 'ct' });

        const rootChildren = vfs.dir_list(sessionPath).map(n => n.name);
        expect(rootChildren.some(name => name.startsWith('search_BRANCH_'))).toBe(false);
        expect(vfs.node_stat(`${sessionPath}/search/meta/search.json`)).toBeTruthy();
    });

    it('does not materialize join nodes for optional-parent convergence', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-join-enabled';
        const engine = new MerkleEngine(vfs, adapter, sessionPath);

        await engine.artifact_materialize('search', { query: 'histology' });
        await engine.artifact_materialize('gather', { selected: ['ds-006'] });
        await engine.artifact_materialize('rename', { name: 'proj-a' });
        await engine.artifact_materialize('harmonize', { normalized: true });

        const joinDir = `${sessionPath}/search/gather/rename/_join_gather_rename`;
        expect(vfs.node_stat(joinDir)).toBeNull();
        expect(vfs.node_stat(`${sessionPath}/search/gather/harmonize/meta/harmonize.json`)).toBeTruthy();
    });

    it('nests downstream descendants under canonical path when no join is materialized', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-join-descendants';
        const engine = new MerkleEngine(vfs, adapter, sessionPath);

        await engine.artifact_materialize('search', { query: 'histology' });
        await engine.artifact_materialize('gather', { selected: ['ds-006'] });
        await engine.artifact_materialize('rename', { name: 'proj-a' });
        await engine.artifact_materialize('harmonize', { normalized: true });
        await engine.artifact_materialize('code', { files: ['train.py'] });

        expect(vfs.node_stat(
            `${sessionPath}/search/gather/rename/_join_gather_rename/harmonize/code/meta/code.json`,
        )).toBeNull();
        expect(vfs.node_stat(
            `${sessionPath}/search/gather/harmonize/code/meta/code.json`,
        )).toBeTruthy();
    });
});
