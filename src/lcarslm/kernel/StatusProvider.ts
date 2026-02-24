/**
 * @file Status Provider
 *
 * Generates system status, version info, and workflow context summaries.
 *
 * @module lcarslm/status
 */

import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { CalypsoStoreActions } from '../types.js';
import { WorkflowAdapter } from '../../dag/bridge/WorkflowAdapter.js';
import { VERSION } from '../../generated/version.js';
import type { Dataset, Project } from '../../core/models/types.js';
import type { WorkflowPosition } from '../../dag/graph/types.js';

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
    public status_generate(aiOnline: boolean, provider: string | null, model: string | null): string {
        const lines: string[] = [
            '╔══════════════════════════════════════╗',
            '║  CALYPSO SYSTEM STATUS               ║',
            '╚══════════════════════════════════════╝',
            ''
        ];

        const coreStatus: string = aiOnline ? '● AI CORE: ONLINE' : '○ AI CORE: OFFLINE';
        lines.push(coreStatus);
        if (aiOnline) {
            lines.push(`  Provider: ${provider?.toUpperCase() || 'UNKNOWN'}`);
            lines.push(`  Model: ${model || 'default'}`);
        } else {
            lines.push('  No provider configured.');
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
     * 
     * This functions as the 'Grounded Context' (RAG) that anchors the LLM
     * in the physical reality of the VFS and the manifest contract.
     */
    public workflowContext_generate(sessionPath: string): string {
        const pos: WorkflowPosition = this.adapter.position_resolve(this.vfs, sessionPath);
        const datasets: Dataset[] = this.store.datasets_getSelected();
        const activeProject: { id: string; name: string } | null = this.store.project_getActive();
        const header = (this.adapter.dag.header as any);

        let context: string = `--- SYSTEM TRUTH (VFS & STORE) ---\n`;
        context += `User: ${this.vfs.username_get()}\n`;
        context += `CWD: ${this.vfs.cwd_get()}\n`;
        context += `Project: ${activeProject ? activeProject.name : 'None'}\n`;
        context += `Selected Datasets: ${datasets.length} (${datasets.map((d: Dataset) => d.id).join(', ')})\n`;
        
        context += `\n--- MANIFEST CONTRACT ---\n`;
        context += `Workflow ID: ${this.adapter.workflowId}\n`;
        context += `Name: ${header.name}\n`;
        context += `Persona: ${header.persona}\n`;
        context += `Description: ${header.description}\n`;

        context += `\n--- WORKFLOW PROGRESS ---\n`;
        context += `Completed Stages: ${pos.completedStages.join(', ') || 'None'}\n`;
        
        const readyStages = pos.allReadiness
            .filter(r => r.ready && !r.complete)
            .map(r => r.nodeId);
        context += `Ready Stages: ${readyStages.join(', ')}\n`;

        if (pos.currentStage) {
            const stage = pos.currentStage;
            context += `\n--- ACTIVE STAGE: [${stage.id.toUpperCase()}] ---\n`;
            context += `Name: ${stage.name}\n`;
            context += `Phase: ${stage.phase || 'N/A'}\n`;
            context += `Instruction: ${stage.instruction}\n`;
            context += `Available Commands: ${stage.commands.join(', ')}\n`;
            
            if (stage.narrative) {
                context += `Narrative Context: ${stage.narrative}\n`;
            }
            if (stage.blueprint && stage.blueprint.length > 0) {
                context += `Execution Blueprint:\n`;
                stage.blueprint.forEach(line => context += `  • ${line}\n`);
            }
        } else if (pos.isComplete) {
            context += `\n--- STATUS: WORKFLOW COMPLETE ---\n`;
        }

        return context;
    }
}
