/**
 * @file Workflow Controller
 *
 * Intelligence layer for workflow-specific guidance and confirmation flows.
 * Handles phase-jump confirmations and stage-next guidance.
 *
 * @module lcarslm/routing/WorkflowController
 */

import type { CalypsoResponse, CalypsoStoreActions, CalypsoAction } from '../types.js';
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { CalypsoStatusCode } from '../types.js';
import { WorkflowAdapter } from '../../dag/bridge/WorkflowAdapter.js';
import { WorkflowSession, type CommandResolution } from '../../dag/bridge/WorkflowSession.js';
import type { DAGNode } from '../../dag/graph/types.js';
import type { AppState } from '../../core/models/types.js';

/**
 * Execution context provided to workflow intelligence methods.
 */
export interface WorkflowControllerContext {
    vfs: VirtualFileSystem;
    storeActions: CalypsoStoreActions;
    workflowAdapter: WorkflowAdapter;
    workflowSession: WorkflowSession;
    sessionPath: string;
    
    /** Response creation helper. */
    response_create: (
        message: string, 
        actions: CalypsoAction[], 
        success: boolean, 
        statusCode: CalypsoStatusCode
    ) => CalypsoResponse;
    /** Resolver for the next step instruction. */
    workflow_nextStep: () => string;
    /** Dispatcher for executing workflow commands. */
    workflow_dispatch: (input: string, resolution: CommandResolution, isConfirmed: boolean) => Promise<CalypsoResponse | null>;
}

/**
 * Controller for workflow-specific guidance and confirmation handshakes.
 */
export class WorkflowController {
    /**
     * Check whether the input is a generic affirmative reply and route it to
     * either a pending phase-jump confirmation or the active stage's safe
     * closing command.
     *
     * @param input - Raw trimmed command string.
     * @param ctx - Workflow context.
     * @returns Workflow response if the input was a confirmation, otherwise null.
     */
    public async confirmation_dispatch(
        input: string, 
        ctx: WorkflowControllerContext
    ): Promise<CalypsoResponse | null> {
        if (!/^(yes|y|affirmative|confirm|ok|go\s+ahead|approve)$/i.test(input)) {
            return null;
        }

        const state: Partial<AppState> = ctx.storeActions.state_get();
        if (state.lastIntent?.startsWith('CONFIRM_JUMP:')) {
            const intentContent: string = state.lastIntent.substring('CONFIRM_JUMP:'.length);
            const [stageId, originalInput] = intentContent.split('|');

            const stage: DAGNode | undefined = ctx.workflowAdapter.dag.nodes.get(stageId);
            if (stage) {
                const clearIntentState: Partial<AppState> = { lastIntent: null };
                ctx.storeActions.state_set(clearIntentState);
                
                const res: CommandResolution = {
                    stage,
                    isJump: true,
                    requiresConfirmation: false,
                };
                return await ctx.workflow_dispatch(originalInput, res, true);
            }
        }

        // Stage-local affirmative continuation.
        // Resolve to the active stage's safe execution verb only; never global-jump.
        const stageCommand: string | null = this.activeStageAffirmativeCommand_resolve(ctx);
        if (stageCommand) {
            const res: CommandResolution = ctx.workflowSession.resolveCommand(stageCommand, true);
            if (res.stage) {
                return await ctx.workflow_dispatch(stageCommand, res, true);
            }
        }

        return null;
    }

    /**
     * Handle natural-language requests for guidance ("what's next?").
     *
     * @param input - Trimmed user input.
     * @param ctx - Workflow context.
     * @returns Guidance response or null if input didn't match guidance patterns.
     */
    public guidance_handle(input: string, ctx: WorkflowControllerContext): CalypsoResponse | null {
        const patterns: RegExp[] = [
            /^what('?s| is| should be)?\s*(the\s+)?next/i, 
            /^next\??$/i, 
            /^how\s+do\s+i\s+(proceed|continue|start)/i, 
            /status/i, 
            /progress/i
        ];
        
        return patterns.some((p: RegExp): boolean => p.test(input)) 
            ? ctx.response_create(ctx.workflow_nextStep(), [], true, CalypsoStatusCode.OK) 
            : null;
    }

    /**
     * Resolve a safe active-stage command for generic affirmative replies.
     *
     * Meta verbs (show/config/status) and commands with required placeholders
     * are excluded to keep short confirmations stage-local.
     *
     * @param ctx - Workflow context.
     * @returns The first safe command for the current stage, or null if none.
     */
    private activeStageAffirmativeCommand_resolve(ctx: WorkflowControllerContext): string | null {
        const activeStageId: string | null = ctx.workflowSession.activeStageId_get();
        if (!activeStageId) return null;

        const node: DAGNode | undefined = ctx.workflowAdapter.dag.nodes.get(activeStageId);
        if (!node) return null;

        interface CommandCandidate {
            command: string;
            required: boolean;
            base: string;
        }

        const candidates: CommandCandidate[] = node.commands
            .map((raw: string): CommandCandidate => {
                const normalized: string = raw.toLowerCase().trim();
                const command: string = normalized.split(/[<\[]/)[0].trim();
                const base: string = command.split(/\s+/)[0] || '';
                const required: boolean = normalized.includes('<');
                return { command, required, base };
            })
            .filter((entry: CommandCandidate): boolean => entry.command.length > 0);

        const metaVerbs: Set<string> = new Set<string>(['show', 'config', 'status']);

        const stageIdExact: CommandCandidate | undefined = candidates.find(
            (entry: CommandCandidate): boolean =>
                entry.command === activeStageId && !entry.required && !metaVerbs.has(entry.base),
        );
        if (stageIdExact) {
            return stageIdExact.command;
        }

        const firstSafe: CommandCandidate | undefined = candidates.find(
            (entry: CommandCandidate): boolean =>
                !entry.required && !metaVerbs.has(entry.base),
        );
        return firstSafe?.command ?? null;
    }
}
