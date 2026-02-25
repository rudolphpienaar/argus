import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import { MerkleEngine } from './MerkleEngine.js';

describe('lcarslm/MerkleEngine runtime materialization scaffolding', () => {
    it('materializes harmonize at its full topology-aware path through all intermediate stages', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-default';
        const engine = new MerkleEngine(vfs, adapter, sessionPath);

        await engine.artifact_materialize('search', { query: 'histology' });
        await engine.artifact_materialize('gather', { selected: ['ds-006'] });
        await engine.artifact_materialize('harmonize', { normalized: true });

        // Old transparent path (structural stages skipped) must NOT exist
        expect(vfs.node_stat(`${sessionPath}/search/gather/harmonize/meta/harmonize.json`)).toBeNull();
        // New full provenance path (all stages visible) must exist
        const harmonizePath = `${sessionPath}/search/gather/join_ml-readiness-gather/gather-gate/join_collect_gather-gate/pre_harmonize/harmonize/meta/harmonize.json`;
        expect(vfs.node_stat(harmonizePath)).toBeTruthy();
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

    it('places harmonize at its full provenance path including join and gate stages', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-join-enabled';
        const engine = new MerkleEngine(vfs, adapter, sessionPath);

        await engine.artifact_materialize('search', { query: 'histology' });
        await engine.artifact_materialize('gather', { selected: ['ds-006'] });
        await engine.artifact_materialize('harmonize', { normalized: true });

        // Confirm harmonize nests under the full primary-parent chain
        const harmonizePath = `${sessionPath}/search/gather/join_ml-readiness-gather/gather-gate/join_collect_gather-gate/pre_harmonize/harmonize/meta/harmonize.json`;
        expect(vfs.node_stat(harmonizePath)).toBeTruthy();
    });

    it('nests downstream descendants under the full provenance chain', async () => {
        const vfs = new VirtualFileSystem('test');
        const adapter = WorkflowAdapter.definition_load('fedml');
        const sessionPath = '/home/test/sessions/fedml/session-join-descendants';
        const engine = new MerkleEngine(vfs, adapter, sessionPath);

        await engine.artifact_materialize('search', { query: 'histology' });
        await engine.artifact_materialize('gather', { selected: ['ds-006'] });
        await engine.artifact_materialize('harmonize', { normalized: true });
        await engine.artifact_materialize('code', { files: ['train.py'] });

        // code nests under harmonize which nests under all intermediate stages
        const codePath = `${sessionPath}/search/gather/join_ml-readiness-gather/gather-gate/join_collect_gather-gate/pre_harmonize/harmonize/pre_code/code/meta/code.json`;
        expect(vfs.node_stat(codePath)).toBeTruthy();
    });
});
