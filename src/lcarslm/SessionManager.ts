/**
 * @file Session Manager
 *
 * Orchestrator for session and project path resolution, realignment,
 * and context anchoring across VFS, Shell, and Merkle layers.
 *
 * @module lcarslm/SessionManager
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { Shell } from '../vfs/Shell.js';
import type { CalypsoStoreActions } from './types.js';
import type { WorkflowSession } from '../dag/bridge/WorkflowSession.js';
import type { MerkleEngine } from './MerkleEngine.js';
import type { PluginHost } from './PluginHost.js';

/**
 * Execution context provided to the SessionManager.
 */
export interface SessionContext {
    vfs: VirtualFileSystem;
    shell: Shell;
    storeActions: CalypsoStoreActions;
    workflowSession: WorkflowSession;
    merkleEngine: MerkleEngine;
    pluginHost: PluginHost;
}

/**
 * Manager for session realignment and project-relative path resolution.
 */
export class SessionManager {
    private sessionPath: string = '';

    constructor(private readonly ctx: SessionContext) {}

    /**
     * Set the initial session path.
     */
    public session_init(path: string): void {
        this.sessionPath = path;
    }

    /**
     * Get the current session path.
     */
    public sessionPath_get(): string {
        return this.sessionPath;
    }

    /**
     * Synchronize session paths across all context providers.
     * Anchors the Shell, VFS, and Merkle layers to the active project context.
     */
    public async session_realign(): Promise<void> {
        const projectName: string | null = this.projectName_resolve();
        const newPath: string = this.sessionPath_resolve(projectName);
        
        const username: string = this.username_resolve();
        const persona: string = this.ctx.shell.env_get('PERSONA') || 'fedml';
        const sessionId: string | null = this.ctx.storeActions.sessionId_get();
        const sessionRoot = sessionId ? `/home/${username}/projects/${persona}/${sessionId}` : null;

        if (sessionRoot) {
            this.ctx.shell.env_set('SCRATCH', sessionRoot);
        }

        if (newPath === this.sessionPath) {
            await this.ctx.workflowSession.sync();
            this.ctx.shell.boundary_set(this.ctx.workflowSession.viewportPath_get());
            return;
        }

        this.sessionPath = newPath;
        this.ctx.workflowSession.sessionPath_set(this.sessionPath);
        this.ctx.merkleEngine.session_setPath(this.sessionPath);
        this.ctx.storeActions.session_setPath(this.sessionPath);
        this.ctx.pluginHost.session_setPath(this.sessionPath); 
        
        await this.ctx.workflowSession.sync();
        
        this.ctx.shell.boundary_set(this.ctx.workflowSession.viewportPath_get());
    }

    /**
     * Resolve the active project name from Store or Shell environment.
     */
    public projectName_resolve(configuredProjectName?: string): string | null {
        const activeProject = this.ctx.storeActions.project_getActive();
        if (activeProject?.name) return activeProject.name;
        
        const configured = (configuredProjectName || '').trim();
        if (configured) return configured;
        
        const env = (this.ctx.shell.env_get('PROJECT') || '').trim();
        if (env) return env;
        
        return null;
    }

    /**
     * Resolve the canonical VFS path for the current session's provenance tree.
     */
    public sessionPath_resolve(projectName: string | null): string {
        const username: string = this.username_resolve();
        const persona: string = this.ctx.shell.env_get('PERSONA') || 'fedml';
        const sessionId: string | null = this.ctx.storeActions.sessionId_get();
        
        if (sessionId) {
            return `/home/${username}/projects/${persona}/${sessionId}/provenance`;
        }
        
        return `/home/${username}/projects/${projectName || 'bootstrap'}/data`;
    }

    /**
     * Resolve the active research persona username.
     */
    public username_resolve(): string {
        return this.ctx.shell.env_get('USER') || 'user';
    }
}
