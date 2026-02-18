import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import { MerkleEngine } from './MerkleEngine.js';

describe('lcarslm/MerkleEngine runtime materialization scaffolding', () => {
    it('uses store+join behavior by default for multi-parent stages', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-default';
        const engine = new MerkleEngine(vfs, adapter, sessionPath);

        await engine.artifact_materialize('search', { query: 'histology' });
        await engine.artifact_materialize('gather', { selected: ['ds-006'] });
        await engine.artifact_materialize('rename', { name: 'proj-a' });
        await engine.artifact_materialize('harmonize', { normalized: true });

        const joinPath = `${sessionPath}/search/gather/rename/_join_gather_rename/harmonize/data/harmonize.json`;
        expect(vfs.node_stat(joinPath)).toBeTruthy();
        expect(vfs.node_stat(`${sessionPath}/search/gather/harmonize/data/harmonize.json`)).toBeNull();
    });

    it('supports explicit legacy mode for compatibility', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-legacy-explicit';
        const engine = new MerkleEngine(
            vfs,
            adapter,
            sessionPath,
            { runtimeMode: 'legacy', joinMaterializationEnabled: false },
        );

        await engine.artifact_materialize('harmonize', { normalized: true });

        expect(vfs.node_stat(`${sessionPath}/search/gather/harmonize/data/harmonize.json`)).toBeTruthy();
    });

    it('can route writes through SessionStore while preserving runtime layout', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-store';
        const engine = new MerkleEngine(vfs, adapter, sessionPath, { runtimeMode: 'store' });

        await engine.artifact_materialize('search', { query: 'ct lung' });
        await engine.artifact_materialize('gather', { selected: ['ds-001'] });

        expect(vfs.node_stat(`${sessionPath}/search/data/search.json`)).toBeTruthy();
        expect(vfs.node_stat(`${sessionPath}/search/gather/data/gather.json`)).toBeTruthy();
    });

    it('preserves branch-on-reexecution behavior in store mode', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-store-branch';
        const engine = new MerkleEngine(vfs, adapter, sessionPath, { runtimeMode: 'store' });

        await engine.artifact_materialize('search', { query: 'mri' });
        await engine.artifact_materialize('search', { query: 'ct' });

        const rootChildren = vfs.dir_list(sessionPath).map(n => n.name);
        expect(rootChildren.some(name => name.startsWith('search_BRANCH_'))).toBe(true);
    });

    it('materializes join node and writes multi-parent stage under join path when enabled', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-join-enabled';
        const engine = new MerkleEngine(
            vfs,
            adapter,
            sessionPath,
            { runtimeMode: 'store', joinMaterializationEnabled: true },
        );

        await engine.artifact_materialize('search', { query: 'histology' });
        await engine.artifact_materialize('gather', { selected: ['ds-006'] });
        await engine.artifact_materialize('rename', { name: 'proj-a' });
        await engine.artifact_materialize('harmonize', { normalized: true });

        const joinDir = `${sessionPath}/search/gather/rename/_join_gather_rename`;
        expect(vfs.node_stat(joinDir)).toBeTruthy();
        expect(vfs.node_stat(`${joinDir}/data/join.json`)).toBeTruthy();
        expect(vfs.node_stat(`${joinDir}/data/gather`)).toBeTruthy();
        expect(vfs.node_stat(`${joinDir}/data/rename`)).toBeTruthy();
        expect(vfs.node_stat(`${joinDir}/harmonize/data/harmonize.json`)).toBeTruthy();
        expect(vfs.node_stat(`${sessionPath}/search/gather/harmonize/data/harmonize.json`)).toBeNull();
    });

    it('nests downstream descendants under join path when join mode is enabled', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-join-descendants';
        const engine = new MerkleEngine(
            vfs,
            adapter,
            sessionPath,
            { runtimeMode: 'store', joinMaterializationEnabled: true },
        );

        await engine.artifact_materialize('search', { query: 'histology' });
        await engine.artifact_materialize('gather', { selected: ['ds-006'] });
        await engine.artifact_materialize('rename', { name: 'proj-a' });
        await engine.artifact_materialize('harmonize', { normalized: true });
        await engine.artifact_materialize('code', { files: ['train.py'] });

        expect(vfs.node_stat(
            `${sessionPath}/search/gather/rename/_join_gather_rename/harmonize/code/data/code.json`,
        )).toBeTruthy();
        expect(vfs.node_stat(
            `${sessionPath}/search/gather/harmonize/code/data/code.json`,
        )).toBeNull();
    });
});
