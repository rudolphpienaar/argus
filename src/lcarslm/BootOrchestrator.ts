/**
 * @file Boot Orchestrator
 *
 * Intelligence layer for the interactive system boot sequence and
 * workflow/persona transitions. Handles telemetry-heavy setup milestones.
 *
 * @module lcarslm/BootOrchestrator
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { Shell } from '../vfs/Shell.js';
import type { 
    CalypsoStoreActions, 
    BootPhase, 
    BootStatus, 
    BootLogEvent 
} from './types.js';
import type { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import type { WorkflowSession } from '../dag/bridge/WorkflowSession.js';
import type { TelemetryBus } from './TelemetryBus.js';
import type { SessionManager } from './SessionManager.js';

/**
 * Execution context provided to the BootOrchestrator.
 */
export interface BootContext {
    vfs: VirtualFileSystem;
    shell: Shell;
    storeActions: CalypsoStoreActions;
    workflowAdapter: WorkflowAdapter;
    workflowSession: WorkflowSession;
    telemetryBus: TelemetryBus;
    sessionManager: SessionManager;
    
    /** Update the adapter instance in the host. */
    adapter_update: (adapter: WorkflowAdapter) => void;
    /** Update the session instance in the host. */
    session_update: (session: WorkflowSession) => void;
}

/**
 * Orchestrator for system lifecycle milestones (Boot and Persona selection).
 */
export class BootOrchestrator {
    private bootSequenceByPhase: Record<BootPhase, number> = {
        login_boot: 0,
        workflow_boot: 0,
    };

    constructor(private readonly ctx: BootContext) {}

    /**
     * Trigger the interactive system boot sequence.
     */
    public async boot(): Promise<void> {
        try {
            const username: string = this.ctx.sessionManager.username_resolve();
            const yieldLoop = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 80));

            // ── Genesis: sync DAG session state ─────────────────────────
            await this.status_emit('sys_genesis', 'INITIATING ARGUS CORE GENESIS', 'WAIT');
            await yieldLoop();
            await this.ctx.workflowSession.sync();
            await this.status_emit('sys_genesis', 'INITIATING ARGUS CORE GENESIS', 'OK');
            await yieldLoop();

            // ── VFS: verify home namespace is materialized ───────────────
            await this.status_emit('sys_vfs', 'MOUNTING VIRTUAL FILE SYSTEM', 'WAIT');
            await yieldLoop();
            const homeNode = this.ctx.vfs.node_stat(`/home/${username}`);
            await this.status_emit('sys_vfs', 'MOUNTING VIRTUAL FILE SYSTEM', homeNode ? 'OK' : 'FAIL');
            await yieldLoop();

            // ── Merkle: integrity engine ready ───────────────────────────
            await this.status_emit('sys_merkle', 'CALIBRATING INTEGRITY ENGINE', 'WAIT');
            await yieldLoop();
            await this.status_emit('sys_merkle', 'CALIBRATING INTEGRITY ENGINE', 'OK');
            await yieldLoop();

            await this.status_emit('sys_ready', `SYSTEM READY FOR USER: ${username.toUpperCase()}`, 'DONE');
        } catch (e: unknown) {
            console.error('System boot failed:', e);
        }
    }

    /**
     * Set the active workflow persona and perform session genesis.
     * 
     * @param workflowId - The ID of the manifest to load.
     * @returns Success status.
     */
    public async workflow_set(workflowId: string | null): Promise<boolean> {
        if (!workflowId) return false;
        try {
            const yieldLoop = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 80));
            
            this.ctx.storeActions.state_set({ currentPersona: workflowId } as any);
            (this.ctx.storeActions as any).session_start?.();

            const username: string = this.ctx.sessionManager.username_resolve();
            const sessionId: string = this.ctx.storeActions.sessionId_get() || 'unknown';

            // 1. MANIFEST
            await this.status_emit('user_manifest', `LOADING PERSONA MANIFEST: ${workflowId.toUpperCase()}`, 'WAIT');
            await yieldLoop();
            try {
                const { WorkflowAdapter } = await import('../dag/bridge/WorkflowAdapter.js');
                const nextAdapter = WorkflowAdapter.definition_load(workflowId);
                this.ctx.adapter_update(nextAdapter);
                await this.status_emit('user_manifest', `LOADING PERSONA MANIFEST: ${workflowId.toUpperCase()}`, 'OK');
                await yieldLoop();
            } catch (e: any) {
                await this.status_emit('user_manifest', `MANIFEST LOAD FAILED: ${e.message}`, 'FAIL');
                throw e;
            }
            
            await this.ctx.sessionManager.session_realign();
            
            // 2. SESSION VFS
            await this.status_emit('user_vfs', 'GENERATING SESSION DATA SPACE', 'WAIT');
            await yieldLoop();
            try {
                const { sessionDir_scaffold } = await import('../vfs/providers/ProjectProvider.js');
                sessionDir_scaffold(this.ctx.vfs, username, undefined, sessionId);
                await this.status_emit('user_vfs', 'GENERATING SESSION DATA SPACE', 'OK');
                await yieldLoop();
            } catch (e: any) {
                await this.status_emit('user_vfs', `VFS GENESIS FAILED: ${e.message}`, 'FAIL');
                throw e;
            }

            // 3. VIEWPORT
            await this.status_emit('user_viewport', 'ESTABLISHING CAUSAL VIEWPORT PORTAL', 'WAIT');
            await yieldLoop();
            try {
                const { WorkflowSession } = await import('../dag/bridge/WorkflowSession.js');
                const nextSession = new WorkflowSession(
                    this.ctx.vfs, 
                    this.ctx.workflowAdapter, 
                    this.ctx.sessionManager.sessionPath_get()
                );
                this.ctx.session_update(nextSession);
                await nextSession.sync();
                await this.status_emit('user_viewport', 'ESTABLISHING CAUSAL VIEWPORT PORTAL', 'OK');
                await yieldLoop();
            } catch (e: any) {
                await this.status_emit('user_viewport', `VIEWPORT SYNC FAILED: ${e.message}`, 'FAIL');
                throw e;
            }
            
            await this.status_emit('user_ready', `PERSONA [${workflowId.toUpperCase()}] ACTIVE`, 'DONE');
            
            return true;
        } catch (e: unknown) {
            console.error('Workflow set failed:', e);
            return false;
        }
    }

    /**
     * Internal helper for standardized boot status telemetry.
     */
    private async status_emit(
        id: string,
        message: string,
        status: BootStatus | null = null,
        phase?: BootPhase,
    ): Promise<void> {
        const resolvedPhase: BootPhase = phase ?? this.bootPhase_resolve(id);
        this.bootSequenceByPhase[resolvedPhase] += 1;
        this.ctx.telemetryBus.emit({ 
            type: 'boot_log', 
            id, 
            message, 
            status, 
            phase: resolvedPhase,
            seq: this.bootSequenceByPhase[resolvedPhase],
            timestamp: new Date().toISOString() 
        } as BootLogEvent);
    }

    /**
     * Resolve boot phase from milestone id prefix.
     */
    private bootPhase_resolve(id: string): BootPhase {
        if (id.startsWith('sys_')) {
            return 'login_boot';
        }
        return 'workflow_boot';
    }
}
