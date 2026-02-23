/**
 * @file Workflow Session Context
 *
 * Manages the synchronized state of a workflow session, acting as the
 * authoritative pointer between the in-memory state and the VFS ground truth.
 *
 * Implements "Check-Then-Crawl" reconciliation and contextual command routing.
 *
 * @module dag/bridge
 * @see docs/dag-engine.adoc
 */

import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { DAGNode, WorkflowPosition } from '../graph/types.js';
import type { WorkflowAdapter } from './WorkflowAdapter.js';

/**
 * Persisted session pointer written to session.json in the session root.
 * Provides the fast-path starting point for Check-Then-Crawl reconciliation.
 */
export interface SessionData {
    /** Workflow ID (e.g. 'fedml', 'chris'). */
    workflowId: string;
    /** Session identifier derived from the session directory name. */
    sessionId: string;
    /** Last-known active stage ID, or null if workflow not yet started. */
    activeStageId: string | null;
    /** ISO timestamp of the last save. */
    updatedAt: string;
}

/**
 * Result of resolving a user command against the active workflow session.
 */
export interface CommandResolution {
    /** The DAGNode that owns this command, or null if not found. */
    stage: DAGNode | null;
    /** True if the matched stage differs from the currently active stage. */
    isJump: boolean;
    /** True if the jump requires explicit user confirmation before proceeding. */
    requiresConfirmation: boolean;
    /** Human-readable warning shown when requiresConfirmation is true. */
    warning?: string;
}

/**
 * Synchronized runtime context for an active workflow session.
 *
 * Implements "Check-Then-Crawl" reconciliation: fast VFS pointer verification
 * before falling back to a full DAG position crawl. Also provides contextual
 * command routing with strict stage-locking.
 */
export class WorkflowSession {
    private activeStageId: string | null = null;
    private lastVfsSync: number = 0;

    constructor(
        private readonly vfs: VirtualFileSystem,
        private readonly adapter: WorkflowAdapter,
        private sessionPath: string
    ) {}

    /**
     * Update the physical session root path.
     *
     * @param path - New absolute session root path.
     */
    public sessionPath_set(path: string): void {
        this.sessionPath = path;
    }

    /**
     * Synchronize the session state with the VFS and session.json.
     * Implements "Check-Then-Crawl" optimization.
     *
     * @returns Promise that resolves when sync is complete.
     */
    public async sync(): Promise<void> {
        const sessionFile = `${this.sessionPath}/session.json`;
        let persisted: SessionData | null = null;

        // 1. Try to load persisted pointer
        try {
            const raw = this.vfs.node_read(sessionFile);
            if (raw) {
                persisted = JSON.parse(raw);
            }
        } catch { /* missing or invalid */ }

        // 2. Perform "Check" (Fast Path)
        // If we have a persisted ID, verify its immediate context
        if (persisted?.activeStageId) {
            if (this.verify_fast(persisted.activeStageId)) {
                this.activeStageId = persisted.activeStageId;
                this.lastVfsSync = Date.now();
                this.viewport_rotate();
                return;
            }
        }

        // 3. Perform "Crawl" (Slow Path)
        // If fast path fails or no persistence, do a full discovery walk
        const pos: WorkflowPosition = this.adapter.position_resolve(this.vfs, this.sessionPath);
        this.activeStageId = pos.currentStage?.id || null;
        
        // Save the reconciled pointer
        this.save();
        this.viewport_rotate();
        this.lastVfsSync = Date.now();
    }

    /**
     * Resolve the current viewport path (absolute path to the logical stage alias).
     *
     * @returns Absolute path to the latest completed stage alias, or null if none.
     */
    public viewportPath_get(): string | null {
        const sessionRoot = this.sessionPath.substring(0, this.sessionPath.lastIndexOf('/'));
        const pos: WorkflowPosition = this.adapter.position_resolve(this.vfs, this.sessionPath);
        const completed = pos.completedStages;
        const latestStageId = completed.length > 0 ? completed[completed.length - 1] : null;
        
        if (!latestStageId) return null;
        return `${sessionRoot}/${latestStageId}`;
    }

    /**
     * Rotate the viewport to point to the latest completed stage.
     */
    public viewport_rotate(): void {
        const pos: WorkflowPosition = this.adapter.position_resolve(this.vfs, this.sessionPath);
        const completed = pos.completedStages;
        const latestStageId = completed.length > 0 ? completed[completed.length - 1] : null;

        // If nothing completed yet, we can't rotate the viewport.
        if (!latestStageId) return;

        // v12.0: Resolve physical stage directory by literal manifest IDs
        const stageSegments = this.stagePath_resolve(latestStageId);
        const stageRoot = `${this.sessionPath}/${stageSegments.join('/')}`;
        const absoluteTarget = `${stageRoot}/output`;
        
        // v11.0: Flat Hierarchy - Session root is our scratchpad
        const sessionRoot = this.sessionPath.substring(0, this.sessionPath.lastIndexOf('/'));

        try {
            // v11.0: Maintain EXACTLY ONE link in the session root (the stage-id alias)
            const aliasName = latestStageId;

            const entries = this.vfs.dir_list(sessionRoot);
            for (const entry of entries) {
                // Remove any link that looks like an old alias (but keep 'provenance' and 'session.json')
                if (entry.type === 'link' && entry.name !== aliasName) {
                    this.vfs.node_remove(entry.path, true);
                }
            }

            const viewportPath = `${sessionRoot}/${aliasName}`;
            const relTarget = this.path_relative(sessionRoot, absoluteTarget);
            
            // Create the simple, direct link in the session root
            this.vfs.link_create(viewportPath, relTarget);
        } catch (e) {
            // ignore
        }
    }

    /**
     * Resolve the physical directory segments for a stage ID.
     * Matches the literal resolution in MerkleEngine.
     *
     * @param stageId - The stage ID to resolve segments for.
     * @returns Array of directory segments from session root to this stage.
     */
    private stagePath_resolve(stageId: string): string[] {
        const node = this.adapter.dag.nodes.get(stageId);
        if (!node) return [stageId];

        if (!node.previous || node.previous.length === 0) {
            return [stageId];
        }

        const parentPath = this.stagePath_resolve(node.previous[0]);
        return [...parentPath, stageId];
    }

    /**
     * Minimal relative path resolver for internal viewport rotation.
     *
     * @param from - The source directory path.
     * @param to - The target path to express relative to `from`.
     * @returns Relative path string (e.g. '../gather/output').
     */
    private path_relative(from: string, to: string): string {
        const fromParts = from.split('/').filter(Boolean);
        const toParts = to.split('/').filter(Boolean);
        
        let common = 0;
        while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
            common++;
        }

        const upCount = fromParts.length - common;
        const up = upCount > 0 ? '../'.repeat(upCount) : '';
        const down = toParts.slice(common).join('/');
        
        return up + down;
    }

    /**
     * Resolve a user command in the current context.
     * 
     * v10.2: Implements Strict Stage-Locking. 
     * Commands are ONLY matched against the active stage.
     * 
     * @param input - The command to resolve.
     * @param contextualOnly - If true, only matches against the active stage.
     * @returns CommandResolution describing which stage (if any) handles this command.
     */
    public resolveCommand(input: string, contextualOnly: boolean = false): CommandResolution {
        const trimmed = input.trim().toLowerCase();
        const parts = trimmed.split(/\s+/);
        const cmd = parts[0];

        // 1. Check Active Stage Priority
        if (this.activeStageId) {
            const activeNode = this.adapter.dag.nodes.get(this.activeStageId);
            if (activeNode && this.nodeHandles_command(activeNode, cmd, trimmed)) {
                return { stage: activeNode, isJump: false, requiresConfirmation: false };
            }
        }

        // 2. Global Fallback (Phase Jump Detection)
        // Forbidden if contextualOnly is true to enforce strict stage-locking.
        if (contextualOnly) {
            return { stage: null, isJump: false, requiresConfirmation: false };
        }

        const fallbackStage = this.adapter.stage_forCommand(input);
        if (fallbackStage) {
            const isJump = fallbackStage.id !== this.activeStageId;
            const isRoot = fallbackStage.previous === null;
            const requiresConfirmation = isJump && !isRoot;

            return {
                stage: fallbackStage,
                isJump,
                requiresConfirmation,
                warning: requiresConfirmation ? `You are currently at the '${this.activeStageId}' stage. Running '${input}' will shift context to '${fallbackStage.id}'.` : undefined
            };
        }

        return { stage: null, isJump: false, requiresConfirmation: false };
    }

    /**
     * Helper to check if a node defines a specific command verb.
     *
     * For single-word commands, matches on the base verb alone.
     * For multi-word commands (e.g. 'show cohort'), requires the full
     * input to start with the command phrase — bare base words are not
     * sufficient to claim a multi-word command.
     *
     * @param node - The DAGNode whose command list to search.
     * @param verb - The base verb extracted from user input.
     * @param fullInput - Full normalized input string for multi-word matching.
     * @returns True if the node owns the given command.
     */
    private nodeHandles_command(node: DAGNode, verb: string, fullInput?: string): boolean {
        return node.commands.some((c: string): boolean => {
            const canonical: string = c.split(/[<\[]/)[0].toLowerCase().trim();
            const parts: string[] = canonical.split(/\s+/);
            if (parts.length > 1) {
                // Multi-word command: require the full input phrase to match
                if (!fullInput) return false;
                return fullInput.toLowerCase().startsWith(canonical);
            }
            // Single-word command: base verb match is sufficient
            return parts[0] === verb;
        });
    }

    /**
     * Mark the current stage as complete and advance the pointer.
     *
     * @param completedStageId - The stage ID that just finished.
     * @returns Promise that resolves when the pointer has been advanced and saved.
     */
    public async advance(completedStageId: string): Promise<void> {
        const pos = this.adapter.position_resolve(this.vfs, this.sessionPath);
        this.activeStageId = pos.currentStage?.id || null;
        this.save();
    }

    /**
     * Force-advance the pointer to a specific stage.
     *
     * @param stageId - The stage ID to set as the active stage.
     */
    public advance_force(stageId: string): void {
        this.activeStageId = stageId;
        this.save();
    }

    /**
     * Get the ID of the current active stage.
     *
     * @returns The active stage ID, or null if the session has not been synced.
     */
    public activeStageId_get(): string | null {
        return this.activeStageId;
    }

    /**
     * Persist the current session state to session.json.
     */
    private save(): void {
        const data: SessionData = {
            workflowId: this.adapter.workflowId,
            sessionId: this.sessionPath.split('/').pop() || 'unknown',
            activeStageId: this.activeStageId,
            updatedAt: new Date().toISOString()
        };

        try {
            const sessionFile = `${this.sessionPath}/session.json`;
            if (this.vfs.node_stat(this.sessionPath)) {
                this.vfs.file_create(sessionFile, JSON.stringify(data, null, 2));
            }
        } catch { /* ignore */ }
    }

    /**
     * Fast-path verification: checks if the prerequisites for a stage are still met
     * AND the stage itself is not yet completed (still the current position).
     *
     * @param stageId - The stage ID to verify as the current active stage.
     * @returns True if the stage is a valid current position; false forces slow-path crawl.
     */
    private verify_fast(stageId: string): boolean {
        const node = this.adapter.dag.nodes.get(stageId);
        if (!node) return false;

        // If this stage already has an artifact, the pointer is stale.
        // Force slow path to advance to the next stage.
        const selfRecord = this.adapter.latestFingerprint_get(this.vfs, this.sessionPath, stageId);
        if (selfRecord) return false;

        if (!node.previous || node.previous.length === 0) return true;

        for (const parentId of node.previous) {
            const record = this.adapter.latestFingerprint_get(this.vfs, this.sessionPath, parentId);
            if (!record) {
                return false;
            }
        }

        return true;
    }
}
