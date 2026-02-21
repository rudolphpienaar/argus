/**
 * @file DAG Store Type Definitions
 *
 * Types for the storage layer that materializes DAG execution into
 * persistent state. The store creates session trees, writes artifacts,
 * inserts topological join nodes at multi-parent convergences, and
 * creates input reference links inside join data/ directories. It is
 * backend-agnostic: the same interface works against VFS (in-memory),
 * real filesystem, or object storage.
 *
 * @module dag/store
 * @see docs/dag-engine.adoc
 */

import type { StageParameters } from '../graph/types.js';
import type { FingerprintRecord } from '../fingerprint/types.js';

// ─── Storage Backend Interface ──────────────────────────────────

/**
 * Backend-agnostic storage interface.
 *
 * The DAG store never touches I/O directly — all reads and writes go
 * through this interface. Swap the backend, everything else stays the same.
 *
 * Today: VFS backend (in-memory). Future: real FS, object storage, ZeroFS.
 *
 * Methods follow the project's RPN naming convention (subject_verb).
 */
export interface StorageBackend {
    /** Write data to a path. Creates parent directories as needed. */
    artifact_write(path: string, data: string): Promise<void>;

    /** Read data from a path. Returns null if path doesn't exist. */
    artifact_read(path: string): Promise<string | null>;

    /** Check whether a path exists. */
    path_exists(path: string): Promise<boolean>;

    /**
     * Create an input reference link from source to target.
     * Used inside topological join nodes' data/ directories to reference
     * parent artifact directories.
     * On real FS: symlink. On VFS: virtual link. On object storage: reference object.
     */
    link_create(source: string, target: string): Promise<void>;

    /** List immediate children of a path. Returns names, not full paths. */
    children_list(path: string): Promise<string[]>;

    /** Create a directory (and parents). No-op if already exists. */
    dir_create(path: string): Promise<void>;
}

// ─── Session ────────────────────────────────────────────────────

/**
 * A session represents one execution of a persona workflow.
 *
 * Sessions live at ~/projects/<name>/data/. Each session
 * materializes a nested directory tree following the DAG topology.
 * Users can log out, come back, choose a session, and continue.
 *
 * @property id - Unique session identifier
 * @property persona - Persona this session belongs to
 * @property manifestVersion - Version of the manifest when session started
 * @property created - ISO timestamp of session creation
 * @property lastActive - ISO timestamp of last activity
 * @property rootPath - Absolute path to the session root in the store
 */
export interface Session {
    id: string;
    persona: string;
    manifestVersion: string;
    created: string;
    lastActive: string;
    rootPath: string;
}

// ─── Session Metadata ───────────────────────────────────────────

/**
 * Serialized session metadata, stored as session.json at the session root.
 */
export interface SessionMetadata {
    id: string;
    persona: string;
    manifestVersion: string;
    created: string;
    lastActive: string;
}

// ─── Artifact Envelope ──────────────────────────────────────────

/**
 * The structural wrapper around every artifact.
 *
 * The DAG engine owns the envelope (metadata + fingerprints). Stage code
 * owns the content block (domain-specific data). This separation keeps
 * the engine generic while stages remain domain-aware.
 *
 * @property stage - Stage ID that produced this artifact
 * @property timestamp - ISO timestamp of artifact creation
 * @property parameters_used - Parameters that were active when this artifact was produced
 * @property content - Domain-specific data (opaque to the engine)
 * @property _fingerprint - This artifact's content hash
 * @property _parent_fingerprints - Recorded fingerprints of parent artifacts at creation time
 */
export interface ArtifactEnvelope {
    stage: string;
    timestamp: string;
    parameters_used: StageParameters;
    content: Record<string, unknown>;
    /** v10.2: Side-effect files materialized by this stage (e.g. '.cohort'). */
    materialized?: string[];
    _fingerprint: string;
    _parent_fingerprints: Record<string, string>;
    /** Internal: Physical path in the VFS (not persisted). */
    _physical_path?: string;
}

// ─── Skip Sentinel ──────────────────────────────────────────────

/**
 * Artifact content for a skipped optional stage.
 *
 * When an optional stage is skipped, the store materializes a sentinel
 * instead of real content. The sentinel gets fingerprinted like any other
 * artifact — the Merkle chain remains unbroken.
 *
 * @property skipped - Always true
 * @property reason - Why the stage was skipped (user choice or script declaration)
 */
export interface SkipSentinelContent {
    skipped: true;
    reason: string;
}

// ─── Join Node Content ──────────────────────────────────────────

/**
 * Artifact content for a topological join node.
 *
 * When a stage has multiple parents, the session materializer inserts
 * a _join_<parent1>_<parent2> node. Its data/ directory contains a
 * join.json artifact with this content, plus symlinks to each parent's
 * data/ directory.
 *
 * @property parents - Parent stage IDs that converge at this join
 * @property parent_paths - Relative paths from the join's data/ to each parent's data/
 */
export interface JoinNodeContent {
    parents: string[];
    parent_paths: Record<string, string>;
}

// ─── Session Store Interface ────────────────────────────────────

/**
 * Session lifecycle management against any StorageBackend.
 *
 * The SessionStore doesn't know about fingerprints or graph topology —
 * it just manages sessions and artifact I/O. The fingerprint layer and
 * graph resolver sit above it.
 */
export interface SessionStoreInterface {
    /** Create a new session for a persona. Returns the session. */
    session_create(persona: string, manifestVersion: string): Promise<Session>;

    /** Resume an existing session by ID. Returns null if not found. */
    session_resume(persona: string, sessionId: string): Promise<Session | null>;

    /** List all sessions for a persona, ordered by lastActive desc. */
    sessions_list(persona: string): Promise<Session[]>;

    /** Resolve the storage path for a stage's data directory within a session. */
    stagePath_resolve(session: Session, stagePath: string[]): string;

    /** Write an artifact to a stage's data directory. */
    artifact_write(session: Session, stagePath: string[], artifact: ArtifactEnvelope): Promise<void>;

    /** Read an artifact from a stage's data directory. Returns null if not found. */
    artifact_read(session: Session, stagePath: string[]): Promise<ArtifactEnvelope | null>;

    /** Check whether a stage has a materialized artifact. */
    artifact_exists(session: Session, stagePath: string[]): Promise<boolean>;

    /**
     * Materialize a topological join node at the convergence point.
     *
     * Creates the _join_<parents> directory with its data/ subdirectory,
     * writes join.json with convergence metadata, and creates input
     * reference links to each parent's data/ directory.
     *
     * @param session - Active session
     * @param parentStagePaths - Map of parent stage ID → path segments to that parent's data/
     * @param nestUnderPath - Path segments to the directory the join node nests under
     * @returns The join node's name (e.g. '_join_gather_rename')
     */
    joinNode_materialize(
        session: Session,
        parentStagePaths: Record<string, string[]>,
        nestUnderPath: string[],
    ): Promise<string>;
}
