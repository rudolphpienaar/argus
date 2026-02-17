/**
 * @file Status Provider
 *
 * Generates system status, version info, and workflow context summaries.
 *
 * @module lcarslm/status
 */

import type { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import type { CalypsoStoreActions } from './types.js';
import type { WorkflowAdapter } from '../dag/bridge/WorkflowAdapter.js';
import { VERSION } from '../generated/version.js';

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

        const coreStatus = simulationMode ? '○ AI CORE: SIMULATION MODE' : '● AI CORE: ONLINE';
        lines.push(coreStatus);
        if (!simulationMode) {
            lines.push(`  Provider: ${provider?.toUpperCase() || 'UNKNOWN'}`);
            lines.push(`  Model: ${model || 'default'}`);
        } else {
            lines.push('  No API key configured.');
        }

        lines.push('');
        lines.push(`○ VFS: ${this.vfs.cwd_get()}`);
        const datasets = this.store.datasets_getSelected();
        lines.push(`○ DATASETS SELECTED: ${datasets.length}`);
        const project = this.store.project_getActive();
        lines.push(`○ ACTIVE PROJECT: ${project ? project.name : 'none'}`);

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
        const pos = this.adapter.position_resolve(this.vfs, sessionPath);
        const datasets = this.store.datasets_getSelected();
        const activeProject = this.store.project_getActive();

        let context = `--- SYSTEM CONTEXT ---\n`;
        context += `Current User: ${this.vfs.username_get()}\n`;
        context += `Working Directory: ${this.vfs.cwd_get()}\n`;
        context += `Active Project: ${activeProject ? activeProject.name : 'None'}\n`;
        context += `Selected Datasets: ${datasets.length} (${datasets.map(d => d.id).join(', ')})\n`;
        context += `\n--- WORKFLOW POSITION ---\n`;
        context += `Workflow: ${this.adapter.workflowId}\n`;
        context += `Completed Stages: ${pos.completedStages.join(', ') || 'None'}\n`;
        context += `Current Stage: ${pos.currentStage?.id || 'Complete'}\n`;
        context += `Ready for: ${pos.availableCommands.join(', ')}\n`;

        return context;
    }
}
