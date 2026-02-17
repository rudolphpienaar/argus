/**
 * @file Status Provider
 *
 * Generates system status, version info, and workflow context summaries.
 *
 * @module lcarslm/status
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { CalypsoStoreActions } from './types.js';
import { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import { VERSION } from '../generated/version.js';
import type { Dataset, Project } from '../core/models/types.js';
import type { WorkflowPosition } from '../dag/graph/types.js';

/**
 * Provider for system status and workflow context.
 */
export class StatusProvider {
    constructor(
        private readonly vfs: VirtualFileSystem,
        private readonly store: CalypsoStoreActions,
        private readonly adapter: WorkflowAdapter
    ) {}

    /**
     * Generate a system status block.
     */
    public status_generate(simulationMode: boolean, provider: string | null, model: string | null): string {
        const lines: string[] = [
            '╔══════════════════════════════════════╗',
            '║  CALYPSO SYSTEM STATUS               ║',
            '╚══════════════════════════════════════╝',
            ''
        ];

        const coreStatus: string = simulationMode ? '○ AI CORE: SIMULATION MODE' : '● AI CORE: ONLINE';
        lines.push(coreStatus);
        if (!simulationMode) {
            lines.push(`  Provider: ${provider?.toUpperCase() || 'UNKNOWN'}`);
            lines.push(`  Model: ${model || 'default'}`);
        } else {
            lines.push('  No API key configured.');
        }

        lines.push('');
        lines.push(`○ VFS: ${this.vfs.cwd_get()}`);
        const datasets: Dataset[] = this.store.datasets_getSelected();
        lines.push(`○ DATASETS SELECTED: ${datasets.length}`);
        const project: { id: string; name: string } | null = this.store.project_getActive();
        lines.push(`○ ACTIVE PROJECT: ${project ? project.name : 'none'}`);

        // Include workflow progress
        const sessionPath: string | null = this.store.session_getPath();
        if (sessionPath) {
            lines.push('');
            lines.push(this.adapter.progress_summarize(this.vfs, sessionPath));
        }

        return lines.join('\n');
    }

    /**
     * Get the system version string.
     */
    public version_get(): string {
        return `CALYPSO CORE V${VERSION}`;
    }

    /**
     * Build system context for LLM awareness.
     */
    public workflowContext_generate(sessionPath: string): string {
        const pos: WorkflowPosition = this.adapter.position_resolve(this.vfs, sessionPath);
        const datasets: Dataset[] = this.store.datasets_getSelected();
        const activeProject: { id: string; name: string } | null = this.store.project_getActive();

        let context: string = `--- SYSTEM CONTEXT ---\n`;
        context += `Current User: ${this.vfs.username_get()}\n`;
        context += `Working Directory: ${this.vfs.cwd_get()}\n`;
        context += `Active Project: ${activeProject ? activeProject.name : 'None'}\n`;
        context += `Selected Datasets: ${datasets.length} (${datasets.map((d: Dataset) => d.id).join(', ')})\n`;
        context += `\n--- WORKFLOW POSITION ---\n`;
        context += `Workflow: ${this.adapter.workflowId}\n`;
        context += `Completed Stages: ${pos.completedStages.join(', ') || 'None'}\n`;
        context += `Current Stage: ${pos.currentStage?.id || 'Complete'}\n`;
        context += `Ready for: ${pos.availableCommands.join(', ')}\n`;

        return context;
    }
}
