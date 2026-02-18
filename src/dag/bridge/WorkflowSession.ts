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
        private readonly sessionPath: string
    ) {}

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
                return;
            }
        }

        // 3. Perform "Crawl" (Slow Path)
        // If fast path fails or no persistence, do a full discovery walk
        const pos: WorkflowPosition = this.adapter.position_resolve(this.vfs, this.sessionPath);
        this.activeStageId = pos.currentStage?.id || null;
        
        // Save the reconciled pointer
        this.save();
        this.lastVfsSync = Date.now();
    }

    /**
     * Resolve a user command in the current context.
     * Prioritizes the active stage.
     */
    public resolveCommand(input: string): CommandResolution {
        const trimmed = input.trim().toLowerCase();
        const parts = trimmed.split(/\s+/);
        const cmd = parts[0];

        // 1. Check Active Stage Priority
        if (this.activeStageId) {
            const activeNode = this.adapter.dag.nodes.get(this.activeStageId);
            if (activeNode) {
                const isMatch: boolean = activeNode.commands.some((c: string): boolean => {
                    const canonical: string = c.split(/[<\[]/)[0].toLowerCase().trim();
                    const base: string = canonical.split(/\s+/)[0];
                    return canonical === trimmed || base === cmd;
                });

                if (isMatch) {
                    return { stage: activeNode, isJump: false, requiresConfirmation: false };
                }
            }
        }

        // 2. Global Fallback (Phase Jump Detection)
        const fallbackStage = this.adapter.stage_forCommand(input);
        if (fallbackStage) {
            const isJump = fallbackStage.id !== this.activeStageId;
            return {
                stage: fallbackStage,
                isJump,
                requiresConfirmation: isJump,
                warning: isJump ? `You are currently at the '${this.activeStageId}' stage. Running '${input}' will shift context to '${fallbackStage.id}'.` : undefined
            };
        }

        return { stage: null, isJump: false, requiresConfirmation: false };
    }

    /**
     * Mark the current stage as complete and advance the pointer.
     */
    public async advance(completedStageId: string): Promise<void> {
        // Full re-resolve after completion to ensure we find the true next leaf
        const pos = this.adapter.position_resolve(this.vfs, this.sessionPath);
        this.activeStageId = pos.currentStage?.id || null;
        this.save();
    }

    /**
     * Force-advance the pointer to a specific stage.
     */
    public advance_force(stageId: string): void {
        this.activeStageId = stageId;
        this.save();
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
        } catch { /* directory might not be created yet */ }
    }

    /**
     * Fast-path verification: checks if the prerequisites for a stage are still met.
     */
    private verify_fast(stageId: string): boolean {
        const node = this.adapter.dag.nodes.get(stageId);
        if (!node) return false;

        // If root, always valid
        if (!node.previous || node.previous.length === 0) return true;

        // Check if all parents have artifacts
        for (const parentId of node.previous) {
            const parentPath = this.adapter.stagePaths.get(parentId);
            if (!parentPath) continue;
            
            const artifactFile = `${this.sessionPath}/${parentPath.artifactFile}`;
            if (!this.vfs.node_stat(artifactFile)) {
                return false; // Parent artifact missing, trigger crawl
            }
        }

        return true;
    }
}
