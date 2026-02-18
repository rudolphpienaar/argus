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
 * Sessions live at `<basePath>/sessions/<persona>/session-<id>/`.
 * Each session has a `data/` directory for the root stage and a
 * `session.json` metadata file.
 */
export class SessionStore implements SessionStoreInterface {
    private readonly rootStageInOwnDirectory: boolean;

    constructor(
        private readonly backend: StorageBackend,
        private readonly basePath: string = '/home/user/sessions',
        options: { rootStageInOwnDirectory?: boolean } = {},
    ) {
        this.rootStageInOwnDirectory = options.rootStageInOwnDirectory ?? false;
    }

    async session_create(persona: string, manifestVersion: string): Promise<Session> {
        const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const rootPath = `${this.basePath}/${persona}/${id}`;

        // Create root directory and data/ subdirectory
        await this.backend.dir_create(`${rootPath}/data`);

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
        const rootPath = `${this.basePath}/${persona}/${sessionId}`;
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
        const personaPath = `${this.basePath}/${persona}`;
        const exists = await this.backend.path_exists(personaPath);
        if (!exists) return [];

        const children = await this.backend.children_list(personaPath);
        const sessions: Session[] = [];

        for (const child of children) {
            const metaPath = `${personaPath}/${child}/session.json`;
            const raw = await this.backend.artifact_read(metaPath);
            if (raw) {
                const metadata: SessionMetadata = JSON.parse(raw);
                sessions.push({
                    ...metadata,
                    rootPath: `${personaPath}/${child}`,
                });
            }
        }

        // Sort by lastActive descending
        sessions.sort((a: Session, b: Session): number => b.lastActive.localeCompare(a.lastActive));
        return sessions;
    }

    stagePath_resolve(session: Session, stagePath: string[]): string {
        if (stagePath.length === 0) {
            return `${session.rootPath}/data`;
        }
        // Default layout:
        //   Root stage: rootPath/data
        //   Nested: rootPath/{path[1]}/{path[2]}/.../{path[N]}/data
        // Compatibility layout:
        //   Root stage: rootPath/{path[0]}/data
        //   Nested: rootPath/{path[0]}/{path[1]}/.../{path[N]}/data
        // This is used by runtime scaffolding to preserve bridge SessionPaths.
        if (stagePath.length === 1) {
            if (this.rootStageInOwnDirectory) {
                return `${session.rootPath}/${stagePath[0]}/data`;
            }
            return `${session.rootPath}/data`;
        }
        const nested = this.rootStageInOwnDirectory
            ? stagePath.join('/')
            : stagePath.slice(1).join('/');
        return `${session.rootPath}/${nested}/data`;
    }

    async artifact_write(
        session: Session,
        stagePath: string[],
        artifact: ArtifactEnvelope,
    ): Promise<void> {
        const dataDir = this.stagePath_resolve(session, stagePath);
        await this.backend.dir_create(dataDir);
        const filePath = `${dataDir}/${artifact.stage}.json`;
        await this.backend.artifact_write(filePath, JSON.stringify(artifact));
    }

    async artifact_read(
        session: Session,
        stagePath: string[],
    ): Promise<ArtifactEnvelope | null> {
        const dataDir = this.stagePath_resolve(session, stagePath);
        // Look for <stageId>.json in data dir
        const stageId = stagePath[stagePath.length - 1];
        const filePath = `${dataDir}/${stageId}.json`;
        const raw = await this.backend.artifact_read(filePath);
        if (!raw) return null;
        return JSON.parse(raw) as ArtifactEnvelope;
    }

    async artifact_exists(
        session: Session,
        stagePath: string[],
    ): Promise<boolean> {
        const dataDir = this.stagePath_resolve(session, stagePath);
        const stageId = stagePath[stagePath.length - 1];
        const filePath = `${dataDir}/${stageId}.json`;
        return this.backend.path_exists(filePath);
    }

    async joinNode_materialize(
        session: Session,
        parentStagePaths: Record<string, string[]>,
        nestUnderPath: string[],
    ): Promise<string> {
        // Sort parent IDs alphabetically for deterministic naming
        const parentIds = Object.keys(parentStagePaths).sort();
        const joinName = `_join_${parentIds.join('_')}`;

        // Create join node directory under nestUnderPath
        const nestDir = this.stagePath_resolve(session, nestUnderPath);
        // Go up from data/ to the stage dir, then create join dir
        const nestStageDir = nestDir.replace(/\/data$/, '');
        const joinDir = `${nestStageDir}/${joinName}`;
        const joinDataDir = `${joinDir}/data`;
        await this.backend.dir_create(joinDataDir);

        // Build parent_paths (relative paths from join data/ to each parent data/)
        const parentPaths: Record<string, string> = {};
        for (const parentId of parentIds) {
            const parentDataDir = this.stagePath_resolve(session, parentStagePaths[parentId]);
            parentPaths[parentId] = parentDataDir;
        }

        // Write join.json
        const joinContent: JoinNodeContent = {
            parents: parentIds,
            parent_paths: parentPaths,
        };
        await this.backend.artifact_write(
            `${joinDataDir}/join.json`,
            JSON.stringify(joinContent),
        );

        // Create input reference links to each parent's data/
        for (const parentId of parentIds) {
            await this.backend.link_create(
                `${joinDataDir}/${parentId}`,
                parentPaths[parentId],
            );
        }

        return joinName;
    }
}
