/**
 * @file DAG Store Layer Tests
 *
 * TDD tests for the store layer: SessionStore lifecycle, artifact
 * materialization, symlink joins, and the VFS StorageBackend.
 *
 * @module dag/store
 * @see docs/dag-engine.adoc
 */

import { describe, it, expect } from 'vitest';
import type {
    StorageBackend,
    Session,
    SessionMetadata,
    ArtifactEnvelope,
    SkipSentinelContent,
    JoinNodeContent,
    SessionStoreInterface,
} from './types.js';
import { VfsBackend } from './backend/vfs.js';
import { SessionStore } from './SessionStore.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';

// ═══════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════

/** Helper to create a mock artifact envelope. */
function artifact_create(
    stage: string,
    content: Record<string, unknown>,
    parentFingerprints: Record<string, string> = {},
): ArtifactEnvelope {
    return {
        stage,
        timestamp: new Date().toISOString(),
        parameters_used: {},
        content,
        _fingerprint: `fp-${stage}`,
        _parent_fingerprints: parentFingerprints,
    };
}

/** Helper to create a skip sentinel. */
function skipSentinel_create(stage: string, reason: string): ArtifactEnvelope {
    const content: SkipSentinelContent = { skipped: true, reason };
    return artifact_create(stage, content as unknown as Record<string, unknown>);
}

// ═══════════════════════════════════════════════════════════════════
// StorageBackend Tests (VFS implementation)
// ═══════════════════════════════════════════════════════════════════

describe('dag/store/backend/vfs', () => {

    function backend_create(): VfsBackend {
        const vfs = new VirtualFileSystem('test');
        return new VfsBackend(vfs);
    }

    it('should write and read an artifact', async () => {
        const backend = backend_create();
        const data = JSON.stringify({ hello: 'world' });
        await backend.artifact_write('/home/test/sessions/s1/data/search.json', data);
        const result = await backend.artifact_read('/home/test/sessions/s1/data/search.json');
        expect(result).toBe(data);
    });

    it('should return null for nonexistent path', async () => {
        const backend = backend_create();
        const result = await backend.artifact_read('/home/test/nonexistent');
        expect(result).toBeNull();
    });

    it('should check path existence', async () => {
        const backend = backend_create();
        expect(await backend.path_exists('/home/test/sessions/s1/data/x.json')).toBe(false);
        await backend.artifact_write('/home/test/sessions/s1/data/x.json', '{}');
        expect(await backend.path_exists('/home/test/sessions/s1/data/x.json')).toBe(true);
    });

    it('should create directories recursively', async () => {
        const backend = backend_create();
        await backend.dir_create('/home/test/a/b/c');
        expect(await backend.path_exists('/home/test/a/b/c')).toBe(true);
        expect(await backend.path_exists('/home/test/a/b')).toBe(true);
        expect(await backend.path_exists('/home/test/a')).toBe(true);
    });

    it('should list children of a directory', async () => {
        const backend = backend_create();
        await backend.dir_create('/home/test/parent/child1');
        await backend.dir_create('/home/test/parent/child2');
        const children = await backend.children_list('/home/test/parent');
        expect(children.sort()).toEqual(['child1', 'child2']);
    });

    it('should create links (virtual symlinks)', async () => {
        const backend = backend_create();
        await backend.dir_create('/home/test/sessions/s1/gather/data');
        await backend.link_create(
            '/home/test/sessions/s1/join/data/gather',
            '/home/test/sessions/s1/gather/data',
        );
        expect(await backend.path_exists('/home/test/sessions/s1/join/data/gather')).toBe(true);
        const content = await backend.artifact_read('/home/test/sessions/s1/join/data/gather');
        const parsed = JSON.parse(content!);
        expect(parsed.__link).toBe(true);
        expect(parsed.target).toBe('/home/test/sessions/s1/gather/data');
    });

    it('should handle write to existing path (overwrite)', async () => {
        const backend = backend_create();
        await backend.artifact_write('/home/test/sessions/s1/data/x.json', '{"v":1}');
        await backend.artifact_write('/home/test/sessions/s1/data/x.json', '{"v":2}');
        const result = await backend.artifact_read('/home/test/sessions/s1/data/x.json');
        expect(result).toBe('{"v":2}');
    });

    it('should handle empty directory listing', async () => {
        const backend = backend_create();
        await backend.dir_create('/home/test/empty');
        const children = await backend.children_list('/home/test/empty');
        expect(children).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════
// SessionStore Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/store/SessionStore', () => {

    function store_create(): { store: SessionStore; backend: VfsBackend } {
        const vfs = new VirtualFileSystem('test');
        const backend = new VfsBackend(vfs);
        const store = new SessionStore(backend, '/home/test/sessions');
        return { store, backend };
    }

    // ─── Session Lifecycle ──────────────────────────────────────

    describe('session lifecycle', () => {

        it('should create a new session with unique ID', async () => {
            const { store } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            expect(session.id).toBeTruthy();
            expect(session.persona).toBe('fedml');
            expect(session.manifestVersion).toBe('1.0.0');
            expect(session.rootPath).toContain(session.id);
        });

        it('should create session root directory and data/ subdirectory', async () => {
            const { store, backend } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            expect(await backend.path_exists(session.rootPath)).toBe(true);
            expect(await backend.path_exists(`${session.rootPath}/data`)).toBe(true);
        });

        it('should write session metadata as session.json', async () => {
            const { store, backend } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const raw = await backend.artifact_read(`${session.rootPath}/session.json`);
            expect(raw).toBeTruthy();
            const meta = JSON.parse(raw!) as SessionMetadata;
            expect(meta.id).toBe(session.id);
            expect(meta.persona).toBe('fedml');
            expect(meta.manifestVersion).toBe('1.0.0');
        });

        it('should resume an existing session', async () => {
            const { store } = store_create();
            const created = await store.session_create('fedml', '1.0.0');
            const resumed = await store.session_resume('fedml', created.id);
            expect(resumed).not.toBeNull();
            expect(resumed!.id).toBe(created.id);
            expect(resumed!.persona).toBe(created.persona);
            expect(resumed!.rootPath).toBe(created.rootPath);
        });

        it('should return null when resuming nonexistent session', async () => {
            const { store } = store_create();
            const result = await store.session_resume('fedml', 'nonexistent');
            expect(result).toBeNull();
        });

        it('should list sessions for a persona ordered by lastActive', async () => {
            const { store } = store_create();
            const s1 = await store.session_create('fedml', '1.0.0');
            await new Promise(r => setTimeout(r, 5));
            const s2 = await store.session_create('fedml', '1.0.0');
            await new Promise(r => setTimeout(r, 5));
            const s3 = await store.session_create('fedml', '1.0.0');
            const list = await store.sessions_list('fedml');
            expect(list.length).toBe(3);
            // Most recently created should be first (latest lastActive)
            expect(list[0].id).toBe(s3.id);
        });

        it('should return empty list for persona with no sessions', async () => {
            const { store } = store_create();
            const list = await store.sessions_list('unknown');
            expect(list).toEqual([]);
        });

        it('should update lastActive on resume', async () => {
            const { store } = store_create();
            const created = await store.session_create('fedml', '1.0.0');
            // Small delay to ensure different timestamp
            await new Promise(r => setTimeout(r, 5));
            const resumed = await store.session_resume('fedml', created.id);
            expect(resumed!.lastActive >= created.lastActive).toBe(true);
        });
    });

    // ─── Stage Path Resolution ──────────────────────────────────

    describe('stage path resolution', () => {

        it('should resolve root stage path', async () => {
            const { store } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const path = store.stagePath_resolve(session, ['search']);
            expect(path).toBe(`${session.rootPath}/data`);
        });

        it('should resolve linear stage path', async () => {
            const { store } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const path = store.stagePath_resolve(session, ['search', 'gather']);
            expect(path).toBe(`${session.rootPath}/gather/data`);
        });

        it('should resolve path through a topological join node', async () => {
            const { store } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const path = store.stagePath_resolve(session, [
                'search', 'gather', 'rename',
                '_join_gather_rename', 'harmonize',
            ]);
            expect(path).toBe(`${session.rootPath}/gather/rename/_join_gather_rename/harmonize/data`);
        });

        it('should resolve deeply nested federation path through join', async () => {
            const { store } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const path = store.stagePath_resolve(session, [
                'search', 'gather', 'rename',
                '_join_gather_rename', 'harmonize', 'code', 'train', 'federate-brief',
            ]);
            expect(path).toBe(`${session.rootPath}/gather/rename/_join_gather_rename/harmonize/code/train/federate-brief/data`);
        });
    });

    // ─── Artifact Materialization ───────────────────────────────

    describe('artifact materialization', () => {

        it('should write an artifact to the stage data directory', async () => {
            const { store, backend } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const artifact = artifact_create('search', { results: [1, 2, 3] });
            await store.artifact_write(session, ['search'], artifact);
            expect(await backend.path_exists(`${session.rootPath}/data/search.json`)).toBe(true);
        });

        it('should read a previously written artifact', async () => {
            const { store } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const artifact = artifact_create('search', { results: [1, 2, 3] });
            await store.artifact_write(session, ['search'], artifact);
            const read = await store.artifact_read(session, ['search']);
            expect(read).not.toBeNull();
            expect(read!.stage).toBe('search');
            expect(read!.content).toEqual({ results: [1, 2, 3] });
        });

        it('should return null for unmaterialized artifact', async () => {
            const { store } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const read = await store.artifact_read(session, ['search']);
            expect(read).toBeNull();
        });

        it('should check artifact existence', async () => {
            const { store } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            expect(await store.artifact_exists(session, ['search'])).toBe(false);
            await store.artifact_write(session, ['search'], artifact_create('search', {}));
            expect(await store.artifact_exists(session, ['search'])).toBe(true);
        });

        it('should materialize a skip sentinel for optional stages', async () => {
            const { store } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const sentinel = skipSentinel_create('rename', 'User chose to skip');
            await store.artifact_write(session, ['search', 'gather', 'rename'], sentinel);
            const read = await store.artifact_read(session, ['search', 'gather', 'rename']);
            expect(read).not.toBeNull();
            const content = read!.content as unknown as SkipSentinelContent;
            expect(content.skipped).toBe(true);
        });

        it('should overwrite an existing artifact (re-execution)', async () => {
            const { store } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            await store.artifact_write(session, ['search'], artifact_create('search', { v: 1 }));
            await store.artifact_write(session, ['search'], artifact_create('search', { v: 2 }));
            const read = await store.artifact_read(session, ['search']);
            expect(read!.content).toEqual({ v: 2 });
        });

        it('should create intermediate directories for nested stages', async () => {
            const { store, backend } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const artifact = artifact_create('train', { model: 'resnet' });
            await store.artifact_write(session, ['search', 'gather', 'harmonize', 'code', 'train'], artifact);
            expect(await backend.path_exists(`${session.rootPath}/gather/harmonize/code/train/data`)).toBe(true);
        });
    });

    // ─── Topological Join Nodes ─────────────────────────────────

    describe('topological join nodes', () => {

        it('should materialize a join node directory named _join_<parents>', async () => {
            const { store, backend } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const name = await store.joinNode_materialize(
                session,
                {
                    gather: ['search', 'gather'],
                    rename: ['search', 'gather', 'rename'],
                },
                ['search', 'gather', 'rename'],
            );
            expect(name).toBe('_join_gather_rename');
            expect(await backend.path_exists(`${session.rootPath}/gather/rename/_join_gather_rename`)).toBe(true);
        });

        it('should create data/ subdirectory inside join node', async () => {
            const { store, backend } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            await store.joinNode_materialize(
                session,
                {
                    gather: ['search', 'gather'],
                    rename: ['search', 'gather', 'rename'],
                },
                ['search', 'gather', 'rename'],
            );
            expect(await backend.path_exists(`${session.rootPath}/gather/rename/_join_gather_rename/data`)).toBe(true);
        });

        it('should write join.json artifact in join data/ directory', async () => {
            const { store, backend } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            await store.joinNode_materialize(
                session,
                {
                    gather: ['search', 'gather'],
                    rename: ['search', 'gather', 'rename'],
                },
                ['search', 'gather', 'rename'],
            );
            const raw = await backend.artifact_read(`${session.rootPath}/gather/rename/_join_gather_rename/data/join.json`);
            expect(raw).toBeTruthy();
            const content = JSON.parse(raw!) as JoinNodeContent;
            expect(content.parents).toEqual(['gather', 'rename']);
        });

        it('should create input reference links to each parent data/ directory', async () => {
            const { store, backend } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            await store.joinNode_materialize(
                session,
                {
                    gather: ['search', 'gather'],
                    rename: ['search', 'gather', 'rename'],
                },
                ['search', 'gather', 'rename'],
            );
            // Links should exist in the join data/ directory
            expect(await backend.path_exists(`${session.rootPath}/gather/rename/_join_gather_rename/data/gather`)).toBe(true);
            expect(await backend.path_exists(`${session.rootPath}/gather/rename/_join_gather_rename/data/rename`)).toBe(true);
        });

        it('should return the join node name', async () => {
            const { store } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            const name = await store.joinNode_materialize(
                session,
                {
                    gather: ['search', 'gather'],
                    rename: ['search', 'gather', 'rename'],
                },
                ['search', 'gather', 'rename'],
            );
            expect(name).toBe('_join_gather_rename');
        });

        it('should always create join nodes for multi-parent stages', async () => {
            const { store, backend } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            // Even when gather is an ancestor of rename, join is created
            await store.joinNode_materialize(
                session,
                {
                    gather: ['search', 'gather'],
                    rename: ['search', 'gather', 'rename'],
                },
                ['search', 'gather', 'rename'],
            );
            expect(await backend.path_exists(`${session.rootPath}/gather/rename/_join_gather_rename`)).toBe(true);
        });

        it('should handle three-parent joins', async () => {
            const { store, backend } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            // root -> a, root -> b, root -> c, then d joins a+b+c
            // nest under c (path: ['root', 'c'])
            const name = await store.joinNode_materialize(
                session,
                {
                    a: ['root', 'a'],
                    b: ['root', 'b'],
                    c: ['root', 'c'],
                },
                ['root', 'c'],
            );
            expect(name).toBe('_join_a_b_c');
            expect(await backend.path_exists(`${session.rootPath}/c/_join_a_b_c/data`)).toBe(true);
            // All three links
            expect(await backend.path_exists(`${session.rootPath}/c/_join_a_b_c/data/a`)).toBe(true);
            expect(await backend.path_exists(`${session.rootPath}/c/_join_a_b_c/data/b`)).toBe(true);
            expect(await backend.path_exists(`${session.rootPath}/c/_join_a_b_c/data/c`)).toBe(true);
        });

        it('should allow downstream stage to nest under join node', async () => {
            const { store, backend } = store_create();
            const session = await store.session_create('fedml', '1.0.0');
            await store.joinNode_materialize(
                session,
                {
                    gather: ['search', 'gather'],
                    rename: ['search', 'gather', 'rename'],
                },
                ['search', 'gather', 'rename'],
            );
            // Now write harmonize artifact nesting under the join node
            const artifact = artifact_create('harmonize', { harmonized: true });
            await store.artifact_write(
                session,
                ['search', 'gather', 'rename', '_join_gather_rename', 'harmonize'],
                artifact,
            );
            expect(await backend.path_exists(
                `${session.rootPath}/gather/rename/_join_gather_rename/harmonize/data/harmonize.json`,
            )).toBe(true);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════
// Type Contract Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/store/types contracts', () => {

    it('ArtifactEnvelope has required structural fields', () => {
        const artifact: ArtifactEnvelope = {
            stage: 'gather',
            timestamp: '2026-02-14T10:30:00Z',
            parameters_used: { auto_select: false },
            content: { datasets: ['ds-001'], cohort_size: 1 },
            _fingerprint: 'abc123',
            _parent_fingerprints: { search: 'def456' },
        };
        expect(artifact.stage).toBe('gather');
        expect(artifact._fingerprint).toBeTruthy();
        expect(artifact._parent_fingerprints['search']).toBe('def456');
    });

    it('SkipSentinelContent marks stage as skipped', () => {
        const sentinel: SkipSentinelContent = {
            skipped: true,
            reason: 'User chose to skip rename',
        };
        expect(sentinel.skipped).toBe(true);
        expect(sentinel.reason).toBeTruthy();
    });

    it('Session has all lifecycle fields', () => {
        const session: Session = {
            id: 'session-20260214-abc',
            persona: 'fedml',
            manifestVersion: '1.0.0',
            created: '2026-02-14T10:00:00Z',
            lastActive: '2026-02-14T10:30:00Z',
            rootPath: '/sessions/fedml/session-20260214-abc',
        };
        expect(session.id).toBeTruthy();
        expect(session.rootPath).toContain(session.id);
    });

    it('JoinNodeContent records parent convergence', () => {
        const join: JoinNodeContent = {
            parents: ['gather', 'rename'],
            parent_paths: {
                gather: '../../../../data',
                rename: '../../data',
            },
        };
        expect(join.parents).toHaveLength(2);
        expect(join.parent_paths['gather']).toContain('data');
        expect(join.parent_paths['rename']).toContain('data');
    });

    it('SessionMetadata is serializable subset of Session', () => {
        const meta: SessionMetadata = {
            id: 'session-20260214-abc',
            persona: 'fedml',
            manifestVersion: '1.0.0',
            created: '2026-02-14T10:00:00Z',
            lastActive: '2026-02-14T10:30:00Z',
        };
        // Should be JSON-serializable (no rootPath — that's derived)
        const json = JSON.stringify(meta);
        const parsed = JSON.parse(json);
        expect(parsed.id).toBe(meta.id);
    });
});
