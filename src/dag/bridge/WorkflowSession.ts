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

export interface SessionData {
    workflowId: string;
    sessionId: string;
    activeStageId: string | null;
    updatedAt: string;
}

export interface CommandResolution {
    stage: DAGNode | null;
    isJump: boolean;
    requiresConfirmation: boolean;
    warning?: string;
}

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
     */
    public sessionPath_set(path: string): void {
        this.sessionPath = path;
    }

    /**
     * Synchronize the session state with the VFS and session.json.
     * Implements "Check-Then-Crawl" optimization.
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
                this.inputSymlink_update();
                return;
            }
        }

        // 3. Perform "Crawl" (Slow Path)
        // If fast path fails or no persistence, do a full discovery walk
        const pos: WorkflowPosition = this.adapter.position_resolve(this.vfs, this.sessionPath);
        this.activeStageId = pos.currentStage?.id || null;
        
        // Save the reconciled pointer
        this.save();
        this.inputSymlink_update();
        this.lastVfsSync = Date.now();
    }

    /**
     * Update the 'input' symlink at the project root to point to the current stage.
     */
    private inputSymlink_update(): void {
        const activeId = this.activeStageId;
        if (!activeId) return;

        const stagePath = this.adapter.stagePaths.get(activeId);
        if (!stagePath) return;

        // The sessionPath is /home/user/projects/PROJ/data
        // The stagePath.dataDir is e.g. search/gather/data
        // The absolute target
        const absoluteTarget = `${this.sessionPath}/${stagePath.dataDir}`;
        
        // The project root is one level up from sessionPath
        const projectRoot = this.sessionPath.substring(0, this.sessionPath.lastIndexOf('/'));
        const symlinkPath = `${projectRoot}/input`;

        try {
            this.vfs.link_create(symlinkPath, absoluteTarget);
        } catch (e) {
            // ignore symlink errors during headless/simulation
        }
    }

    /**
     * Resolve a user command in the current context.
     * 
     * v10.2: Implements Strict Stage-Locking. 
     * Commands are ONLY matched against the active stage.
     * 
     * @param input - The command to resolve.
     * @param contextualOnly - If true, only matches against the active stage.
     */
    public resolveCommand(input: string, contextualOnly: boolean = false): CommandResolution {
        const trimmed = input.trim().toLowerCase();
        const parts = trimmed.split(/\s+/);
        const cmd = parts[0];

        // 1. Check Active Stage Priority
        if (this.activeStageId) {
            const activeNode = this.adapter.dag.nodes.get(this.activeStageId);
            if (activeNode && this.nodeHandles_command(activeNode, cmd)) {
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
     */
    private nodeHandles_command(node: DAGNode, verb: string): boolean {
        return node.commands.some((c: string): boolean => {
            const canonical: string = c.split(/[<\[]/)[0].toLowerCase().trim();
            const base: string = canonical.split(/\s+/)[0];
            return base === verb;
        });
    }

    /**
     * Mark the current stage as complete and advance the pointer.
     */
    public async advance(completedStageId: string): Promise<void> {
        const pos = this.adapter.position_resolve(this.vfs, this.sessionPath);
        this.activeStageId = pos.currentStage?.id || null;
        this.save();
        this.inputSymlink_update();
    }

    /**
     * Force-advance the pointer to a specific stage.
     */
    public advance_force(stageId: string): void {
        this.activeStageId = stageId;
        this.save();
        this.inputSymlink_update();
    }

    /**
     * Get the ID of the current active stage.
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
