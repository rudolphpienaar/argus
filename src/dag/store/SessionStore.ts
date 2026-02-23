/**
 * @file Session Store
 *
 * Manages session lifecycle, artifact I/O, and topological join node
 * materialization against any StorageBackend.
 *
 * @module dag/store
 * @see docs/dag-engine.adoc
 */

import type {
    StorageBackend,
    Session,
    SessionMetadata,
    ArtifactEnvelope,
    JoinNodeContent,
    SessionStoreInterface,
} from './types.js';

/**
 * Session store implementation.
 *
 * Sessions live at `<basePath>/<project>/data/`.
 * Each session has a `session.json` metadata file.
 */
export class SessionStore implements SessionStoreInterface {
    constructor(
        private readonly backend: StorageBackend,
        private readonly basePath: string = '/home/user/projects',
    ) {}

    async session_create(persona: string, manifestVersion: string): Promise<Session> {
        // v10.2: Session ID is now 'data' to align with project-relative materialization
        const id = 'data';
        const personaProject: string = persona.trim();
        const rootPath = this.basePath === '/runtime-not-used'
            ? this.basePath
            : `${this.basePath}/${personaProject}/data`;

        // Create root directory
        await this.backend.dir_create(rootPath);

        const now = new Date().toISOString();
        const metadata: SessionMetadata = {
            id,
            persona,
            manifestVersion,
            created: now,
            lastActive: now,
        };

        // Write session.json
        await this.backend.artifact_write(
            `${rootPath}/session.json`,
            JSON.stringify(metadata),
        );

        return { ...metadata, rootPath };
    }

    async session_resume(persona: string, sessionId: string): Promise<Session | null> {
        // v10.2: Resume expects sessionId to be the project name or full data path
        const rootPath = sessionId.startsWith('/') ? sessionId : `${this.basePath}/${sessionId}/data`;
        const metaPath = `${rootPath}/session.json`;

        const raw = await this.backend.artifact_read(metaPath);
        if (!raw) return null;

        const metadata: SessionMetadata = JSON.parse(raw);

        // Update lastActive
        metadata.lastActive = new Date().toISOString();
        await this.backend.artifact_write(metaPath, JSON.stringify(metadata));

        return { ...metadata, rootPath };
    }

    async sessions_list(persona: string): Promise<Session[]> {
        const exists = await this.backend.path_exists(this.basePath);
        if (!exists) return [];

        const projects = await this.backend.children_list(this.basePath);
        const sessions: Session[] = [];

        for (const project of projects) {
            const rootPath = `${this.basePath}/${project}/data`;
            const metaPath = `${rootPath}/session.json`;
            const raw = await this.backend.artifact_read(metaPath);
            if (raw) {
                const metadata: SessionMetadata = JSON.parse(raw);
                if (metadata.persona === persona) {
                    sessions.push({
                        ...metadata,
                        rootPath,
                    });
                }
            }
        }

        // Sort by lastActive descending
        sessions.sort((a: Session, b: Session): number => b.lastActive.localeCompare(a.lastActive));
        return sessions;
    }

    stagePath_resolve(session: Session, stagePath: string[]): string {
        if (stagePath.length === 0) {
            return session.rootPath;
        }
        if (stagePath.length === 1) {
            return `${session.rootPath}/${stagePath[0]}`;
        }
        const nested = stagePath.join('/');
        return `${session.rootPath}/${nested}`;
    }

    async artifact_write(
        session: Session,
        stagePath: string[],
        artifact: ArtifactEnvelope,
    ): Promise<void> {
        const stageDir = this.stagePath_resolve(session, stagePath);
        const metaDir = `${stageDir}/meta`;
        await this.backend.dir_create(metaDir);
        const filePath = `${metaDir}/${artifact.stage}.json`;
        await this.backend.artifact_write(filePath, JSON.stringify(artifact));
    }

    async artifact_read(
        session: Session,
        stagePath: string[],
    ): Promise<ArtifactEnvelope | null> {
        const stageDir = this.stagePath_resolve(session, stagePath);
        // Look for <stageId>.json in meta/ dir
        const stageId = stagePath[stagePath.length - 1];
        const filePath = `${stageDir}/meta/${stageId}.json`;
        const raw = await this.backend.artifact_read(filePath);
        if (!raw) return null;
        return JSON.parse(raw) as ArtifactEnvelope;
    }

    async artifact_exists(
        session: Session,
        stagePath: string[],
    ): Promise<boolean> {
        const stageDir = this.stagePath_resolve(session, stagePath);
        const stageId = stagePath[stagePath.length - 1];
        const filePath = `${stageDir}/meta/${stageId}.json`;
        return this.backend.path_exists(filePath);
    }
}
