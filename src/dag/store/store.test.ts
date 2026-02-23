/**
 * @file DAG Store Layer Tests
 *
 * TDD tests for the store layer: SessionStore lifecycle, artifact
 * materialization, and the VFS StorageBackend.
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

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe('dag/store/SessionStore/lifecycle', (): void => {
    it('should create a new session with session.json', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);

        expect(session.id).toBe('data');
        expect(session.persona).toBe(TEST_PERSONA);
        expect(await backend.path_exists(`${session.rootPath}/session.json`)).toBe(true);
    });

    it('should resume an existing session', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        const original: Session = await session_create(store);
        const resumed: Session | null = await store.session_resume(TEST_PERSONA, original.rootPath);

        expect(resumed).not.toBeNull();
        expect(resumed?.rootPath).toBe(original.rootPath);
    });

    it('should list all sessions for a persona', async (): Promise<void> => {
        const { store }: StoreFixture = storeFixture_create();
        await store.session_create('persona-a', '1.0.0');
        await store.session_create('persona-a', '1.0.0');
        await store.session_create('persona-b', '1.0.0');

        const sessionsA: Session[] = await store.sessions_list('persona-a');
        expect(sessionsA).toHaveLength(1);
    });
});

describe('dag/store/SessionStore/artifacts', (): void => {
    it('should write and read an artifact in the correct physical directory', async (): Promise<void> => {
        const { store, backend }: StoreFixture = storeFixture_create();
        const session: Session = await session_create(store);
        const artifact: ArtifactEnvelope = artifact_create('gather', { count: 10 });

        await store.artifact_write(session, ['search', 'gather'], artifact);

        // v12.0 Physical path: root/search/gather/meta/gather.json
        const expectedPath = `${session.rootPath}/search/gather/meta/gather.json`;
        expect(await backend.path_exists(expectedPath)).toBe(true);

        const read: ArtifactEnvelope | null = await store.artifact_read(session, ['search', 'gather']);
        expect(read).toEqual(artifact);
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
        expect(await backend.path_exists(`${session.rootPath}/search/gather/harmonize/code/train/meta`)).toBe(true);
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
