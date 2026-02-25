/**
 * @file Status Provider
 *
 * Grounding and status generation for the ARGUS environment.
 * Maps VFS/Store state to human-readable summaries and RAG context.
 *
 * @module lcarslm/kernel/StatusProvider
 */

import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { AppState } from '../../core/models/types.js';
import type { CalypsoStoreActions } from '../types.js';
import type { WorkflowAdapter } from '../../dag/bridge/WorkflowAdapter.js';
import { VERSION } from '../../generated/version.js';

export class StatusProvider {
    constructor(
        private readonly vfs: VirtualFileSystem,
        private readonly store: CalypsoStoreActions,
        private readonly workflow: WorkflowAdapter
    ) {}

    /**
     * Generate a grounding context for the LLM based on the current session.
     */
    public workflowContext_generate(sessionPath: string): string {
        const pos = this.workflow.position_resolve(this.vfs, sessionPath);
        const activeStage = pos.currentStage?.id || 'none';
        const completed = pos.completedStages.join(', ') || 'none';
        const ready = pos.availableCommands.join(', ') || 'none';
        const next = pos.nextInstruction || 'Workflow complete.';

        return [
            `### SESSION GROUNDING:`,
            `○ CURRENT STAGE: ${activeStage}`,
            `○ COMPLETED STAGES: ${completed}`,
            `○ READY COMMANDS (Vocabulary Jail): ${ready}`,
            `○ NEXT GUIDANCE: ${next}`,
            `○ SESSION_ROOT: ${sessionPath}`
        ].join('\n');
    }

    /**
     * Generate a human-readable status summary.
     */
    public status_generate(
        engineAvailable: boolean, 
        provider: string | null, 
        model: string | null
    ): string {
        const state = this.store.state_get();
        const persona = state.currentPersona || 'none';
        const session = state.currentSessionId || 'none';
        const datasets = (state.selectedDatasets || []).length;
        const aiStatus = engineAvailable ? `ONLINE (${provider}/${model})` : 'OFFLINE';

        return [
            `● ARGUS OS STATUS`,
            `○ SYSTEM VERSION: ${VERSION}`,
            `○ ACTIVE PERSONA: ${persona.toUpperCase()}`,
            `○ SESSION IDENTITY: ${session}`,
            `○ COHORT SELECTION: ${datasets} dataset(s) staged`,
            `○ AI CORE STATUS: ${aiStatus}`
        ].join('\n');
    }

    public version_get(): string {
        return VERSION;
    }
}
