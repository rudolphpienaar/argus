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
    Session,
    SessionMetadata,
    ArtifactEnvelope,
    SkipSentinelContent,
    JoinNodeContent,
} from './types.js';
import { VfsBackend } from './backend/vfs.js';
import { SessionStore } from './SessionStore.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';

// ═══════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════

const TEST_PERSONA: string = 'fedml';
const TEST_MANIFEST_VERSION: string = '1.0.0';
const TEST_SESSIONS_ROOT: string = '/home/test/projects';

interface StoreFixture {
    store: SessionStore;
    backend: VfsBackend;
}

interface JoinSpec {
    parentStagePaths: Record<string, string[]>;
    nestUnderPath: string[];
    joinName: string;
    joinDirRelative: string;
}

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

function backend_create(): VfsBackend {
    const vfs: VirtualFileSystem = new VirtualFileSystem('test');
    return new VfsBackend(vfs);
}

function storeFixture_create(): StoreFixture {
    const backend: VfsBackend = backend_create();
    const store: SessionStore = new SessionStore(
        backend,
        TEST_SESSIONS_ROOT,
    );
    return { store, backend };
}

async function session_create(store: SessionStore): Promise<Session> {
    return store.session_create(TEST_PERSONA, TEST_MANIFEST_VERSION);
}

function joinSpec_default(): JoinSpec {
    return {
        parentStagePaths: {
            gather: ['search', 'gather'],
            rename: ['search', 'gather', 'rename'],
        },
        nestUnderPath: ['search', 'gather', 'rename'],
        joinName: '_join_gather_rename',
        joinDirRelative: 'search/gather/rename/_join_gather_rename',
    };
}

async function joinDefault_materialize(store: SessionStore, session: Session): Promise<string> {
    const spec: JoinSpec = joinSpec_default();
    return store.joinNode_materialize(
        session,
        spec.parentStagePaths,
        spec.nestUnderPath,
    );
}

async function delay_wait(ms: number): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, ms);
    });
}

// ═══════════════════════════════════════════════════════════════════
// StorageBackend Tests (VFS implementation)
// ═══════════════════════════════════════════════════════════════════

describe('dag/store/backend/vfs', (): void => {
    it('should write and read an artifact', async (): Promise<void> => {
        const backend: VfsBackend = backend_create();
        const data: string = JSON.stringify({ hello: 'world' });
        await backend.artifact_write('/home/test/sessions/s1/data/search.json', data);
        const result: string | null = await backend.artifact_read('/home/test/sessions/s1/data/search.json');
        expect(result).toBe(data);
    });

    it('should return null for nonexistent path', async (): Promise<void> => {
        const backend: VfsBackend = backend_create();
        const result: string | null = await backend.artifact_read('/home/test/nonexistent');
        expect(result).toBeNull();
    });

    it('should check path existence', async (): Promise<void> => {
        const backend: VfsBackend = backend_create();
        expect(await backend.path_exists('/home/test/sessions/s1/data/x.json')).toBe(false);
        await backend.artifact_write('/home/test/sessions/s1/data/x.json', '{}');
        expect(await backend.path_exists('/home/test/sessions/s1/data/x.json')).toBe(true);
    });

    it('should create directories recursively', async (): Promise<void> => {
        const backend: VfsBackend = backend_create();
        await backend.dir_create('/home/test/a/b/c');
        expect(await backend.path_exists('/home/test/a/b/c')).toBe(true);
        expect(await backend.path_exists('/home/test/a/b')).toBe(true);
        expect(await backend.path_exists('/home/test/a')).toBe(true);
    });

    it('should list children of a directory', async (): Promise<void> => {
        const backend: VfsBackend = backend_create();
        await backend.dir_create('/home/test/parent/child1');
        await backend.dir_create('/home/test/parent/child2');
        const children: string[] = await backend.children_list('/home/test/parent');
        expect(children.sort()).toEqual(['child1', 'child2']);
    });

    it('should create links (virtual symlinks)', async (): Promise<void> => {
        const backend: VfsBackend = backend_create();
        await backend.dir_create('/home/test/sessions/s1/gather/data');
        await backend.artifact_write('/home/test/sessions/s1/gather/data/payload.json', '{"ok":true}');
        await backend.link_create(
            '/home/test/sessions/s1/join/data/gather',
            '/home/test/sessions/s1/gather/data',
        );
        expect(await backend.path_exists('/home/test/sessions/s1/join/data/gather')).toBe(true);
        const content: string | null = await backend.artifact_read('/home/test/sessions/s1/join/data/gather/payload.json');
        expect(content).toBe('{"ok":true}');
    });

    it('should handle write to existing path (overwrite)', async (): Promise<void> => {
        const backend: VfsBackend = backend_create();
        await backend.artifact_write('/home/test/sessions/s1/data/x.json', '{"v":1}');
        await backend.artifact_write('/home/test/sessions/s1/data/x.json', '{"v":2}');
        const result: string | null = await backend.artifact_read('/home/test/sessions/s1/data/x.json');
        expect(result).toBe('{"v":2}');
    });

    it('should handle empty directory listing', async (): Promise<void> => {
        const backend: VfsBackend = backend_create();
        await backend.dir_create('/home/test/empty');
        const children: string[] = await backend.children_list('/home/test/empty');
        expect(children).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════
// SessionStore Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/store/SessionStore/session lifecycle', (): void => {
    it('should create a new session with unique ID', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        expect(session.id).toBeTruthy();
        expect(session.persona).toBe(TEST_PERSONA);
        expect(session.manifestVersion).toBe(TEST_MANIFEST_VERSION);
        expect(session.rootPath).toBe('/home/test/projects/fedml/data');
    });

    it('should create session root directory and data/ subdirectory', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        expect(await backend.path_exists(session.rootPath)).toBe(true);
    });

    it('should write session metadata as session.json', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const raw: string | null = await backend.artifact_read(`${session.rootPath}/session.json`);
        expect(raw).toBeTruthy();
        const meta: SessionMetadata = JSON.parse(raw ?? '{}') as SessionMetadata;
        expect(meta.id).toBe(session.id);
        expect(meta.persona).toBe(TEST_PERSONA);
        expect(meta.manifestVersion).toBe(TEST_MANIFEST_VERSION);
    });

    it('should resume an existing session', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const created: Session = await session_create(store);
        const resumed: Session | null = await store.session_resume(TEST_PERSONA, TEST_PERSONA);
        expect(resumed).not.toBeNull();
        expect(resumed?.id).toBe(created.id);
        expect(resumed?.persona).toBe(created.persona);
        expect(resumed?.rootPath).toBe(created.rootPath);
    });

    it('should return null when resuming nonexistent session', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const result: Session | null = await store.session_resume(TEST_PERSONA, 'nonexistent');
        expect(result).toBeNull();
    });

    it('should list sessions for a persona ordered by lastActive', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const s1: Session = await session_create(store);
        const list: Session[] = await store.sessions_list(TEST_PERSONA);
        expect(list.length).toBe(1);
        expect(list[0].id).toBe(s1.id);
    });

    it('should return empty list for persona with no sessions', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const list: Session[] = await store.sessions_list('unknown');
        expect(list).toEqual([]);
    });

    it('should update lastActive on resume', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const created: Session = await session_create(store);
        await delay_wait(5);
        const resumed: Session | null = await store.session_resume(TEST_PERSONA, TEST_PERSONA);
        expect((resumed?.lastActive ?? '') >= created.lastActive).toBe(true);
    });
});

describe('dag/store/SessionStore/stage path resolution', (): void => {
    it('should resolve root stage path', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const path: string = store.stagePath_resolve(session, ['search']);
        expect(path).toBe(`${session.rootPath}/search/data`);
    });

    it('should resolve linear stage path', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const path: string = store.stagePath_resolve(session, ['search', 'gather']);
        expect(path).toBe(`${session.rootPath}/search/gather/data`);
    });

    it('should resolve path through a topological join node', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const path: string = store.stagePath_resolve(session, [
            'search', 'gather', 'rename',
            '_join_gather_rename', 'harmonize',
        ]);
        expect(path).toBe(`${session.rootPath}/search/gather/rename/_join_gather_rename/harmonize/data`);
    });

    it('should resolve deeply nested federation path through join', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const path: string = store.stagePath_resolve(session, [
            'search', 'gather', 'rename',
            '_join_gather_rename', 'harmonize', 'code', 'train', 'federate-brief',
        ]);
        expect(path).toBe(`${session.rootPath}/search/gather/rename/_join_gather_rename/harmonize/code/train/federate-brief/data`);
    });

});

describe('dag/store/SessionStore/artifact materialization', (): void => {
    it('should write an artifact to the stage data directory', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const artifact: ArtifactEnvelope = artifact_create('search', { results: [1, 2, 3] });
        await store.artifact_write(session, ['search'], artifact);
        expect(await backend.path_exists(`${session.rootPath}/search/data/search.json`)).toBe(true);
    });

    it('should read a previously written artifact', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const artifact: ArtifactEnvelope = artifact_create('search', { results: [1, 2, 3] });
        await store.artifact_write(session, ['search'], artifact);
        const read: ArtifactEnvelope | null = await store.artifact_read(session, ['search']);
        expect(read).not.toBeNull();
        expect(read?.stage).toBe('search');
        expect(read?.content).toEqual({ results: [1, 2, 3] });
    });

    it('should return null for unmaterialized artifact', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const read: ArtifactEnvelope | null = await store.artifact_read(session, ['search']);
        expect(read).toBeNull();
    });

    it('should check artifact existence', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        expect(await store.artifact_exists(session, ['search'])).toBe(false);
        await store.artifact_write(session, ['search'], artifact_create('search', {}));
        expect(await store.artifact_exists(session, ['search'])).toBe(true);
    });

    it('should materialize a skip sentinel for optional stages', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const sentinel: ArtifactEnvelope = skipSentinel_create('rename', 'User chose to skip');
        await store.artifact_write(session, ['search', 'gather', 'rename'], sentinel);
        const read: ArtifactEnvelope | null = await store.artifact_read(session, ['search', 'gather', 'rename']);
        expect(read).not.toBeNull();
        if (!read) {
            throw new Error('Expected skip sentinel artifact to be materialized.');
        }
        const content: SkipSentinelContent = read.content as unknown as SkipSentinelContent;
        expect(content.skipped).toBe(true);
    });

    it('should overwrite an existing artifact (re-execution)', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        await store.artifact_write(session, ['search'], artifact_create('search', { v: 1 }));
        await store.artifact_write(session, ['search'], artifact_create('search', { v: 2 }));
        const read: ArtifactEnvelope | null = await store.artifact_read(session, ['search']);
        expect(read?.content).toEqual({ v: 2 });
    });

    it('should create intermediate directories for nested stages', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const artifact: ArtifactEnvelope = artifact_create('train', { model: 'resnet' });
        await store.artifact_write(session, ['search', 'gather', 'harmonize', 'code', 'train'], artifact);
        expect(await backend.path_exists(`${session.rootPath}/search/gather/harmonize/code/train/data`)).toBe(true);
    });
});

describe('dag/store/SessionStore/topological join nodes/basic', (): void => {
    it('should materialize a join node directory named _join_<parents>', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const spec: JoinSpec = joinSpec_default();
        const name: string = await joinDefault_materialize(store, session);
        expect(name).toBe(spec.joinName);
        expect(await backend.path_exists(`${session.rootPath}/${spec.joinDirRelative}`)).toBe(true);
    });

    it('should create data/ subdirectory inside join node', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const spec: JoinSpec = joinSpec_default();
        await joinDefault_materialize(store, session);
        expect(await backend.path_exists(`${session.rootPath}/${spec.joinDirRelative}/data`)).toBe(true);
    });

    it('should write join.json artifact in join data/ directory', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const spec: JoinSpec = joinSpec_default();
        await joinDefault_materialize(store, session);
        const raw: string | null = await backend.artifact_read(`${session.rootPath}/${spec.joinDirRelative}/data/join.json`);
        expect(raw).toBeTruthy();
        const content: JoinNodeContent = JSON.parse(raw ?? '{}') as JoinNodeContent;
        expect(content.parents).toEqual(['gather', 'rename']);
    });

    it('should create input reference links to each parent data/ directory', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const spec: JoinSpec = joinSpec_default();
        await joinDefault_materialize(store, session);
        const children: string[] = await backend.children_list(`${session.rootPath}/${spec.joinDirRelative}/data`);
        expect(children).toContain('gather');
        expect(children).toContain('rename');
    });

    it('should return the join node name', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const spec: JoinSpec = joinSpec_default();
        const name: string = await joinDefault_materialize(store, session);
        expect(name).toBe(spec.joinName);
    });

    it('should always create join nodes for multi-parent stages', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const spec: JoinSpec = joinSpec_default();
        await joinDefault_materialize(store, session);
        expect(await backend.path_exists(`${session.rootPath}/${spec.joinDirRelative}`)).toBe(true);
    });
});

describe('dag/store/SessionStore/topological join nodes/fan-in and nesting', (): void => {
    it('should handle three-parent joins', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const name: string = await store.joinNode_materialize(
            session,
            {
                a: ['root', 'a'],
                b: ['root', 'b'],
                c: ['root', 'c'],
            },
            ['root', 'c'],
        );
        expect(name).toBe('_join_a_b_c');
        expect(await backend.path_exists(`${session.rootPath}/root/c/_join_a_b_c/data`)).toBe(true);
        const children: string[] = await backend.children_list(`${session.rootPath}/root/c/_join_a_b_c/data`);
        expect(children).toContain('a');
        expect(children).toContain('b');
        expect(children).toContain('c');
    });

    it('should allow downstream stage to nest under join node', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        await joinDefault_materialize(store, session);

        const artifact: ArtifactEnvelope = artifact_create('harmonize', { harmonized: true });
        await store.artifact_write(
            session,
            ['search', 'gather', 'rename', '_join_gather_rename', 'harmonize'],
            artifact,
        );

        expect(await backend.path_exists(
            `${session.rootPath}/search/gather/rename/_join_gather_rename/harmonize/data/harmonize.json`,
        )).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════
// Type Contract Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/store/types contracts', (): void => {
    it('ArtifactEnvelope has required structural fields', (): void => {
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

    it('SkipSentinelContent marks stage as skipped', (): void => {
        const sentinel: SkipSentinelContent = {
            skipped: true,
            reason: 'User chose to skip rename',
        };
        expect(sentinel.skipped).toBe(true);
        expect(sentinel.reason).toBeTruthy();
    });

    it('Session has all lifecycle fields', (): void => {
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

    it('JoinNodeContent records parent convergence', (): void => {
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

    it('SessionMetadata is serializable subset of Session', (): void => {
        const meta: SessionMetadata = {
            id: 'session-20260214-abc',
            persona: 'fedml',
            manifestVersion: '1.0.0',
            created: '2026-02-14T10:00:00Z',
            lastActive: '2026-02-14T10:30:00Z',
        };
        const json: string = JSON.stringify(meta);
        const parsed: SessionMetadata = JSON.parse(json) as SessionMetadata;
        expect(parsed.id).toBe(meta.id);
    });
});
