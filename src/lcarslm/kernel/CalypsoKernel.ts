/**
 * @file Calypso Kernel
 *
 * The Central Nervous System (CNS) of the ARGUS environment.
 * Encapsulates deterministic and probabilistic intent resolution,
 * RAG context injection, and structural safety guardrails.
 *
 * This module implements the "Structural Bypass" required for 
 * quantitative drift experiments (Null Hypothesis mode).
 *
 * @module lcarslm/kernel/CalypsoKernel
 */

import type { 
    CalypsoResponse, 
    CalypsoAction, 
    CalypsoStoreActions 
} from '../types.js';
import { CalypsoStatusCode } from '../types.js';
import type { LCARSEngine } from './LCARSEngine.js';
import type { SearchProvider } from '../SearchProvider.js';
import { IntentParser, type IntentParserContext } from './IntentParser.js';
import { StatusProvider } from './StatusProvider.js';
import { IntentGuard, IntentGuardMode } from './IntentGuard.js';
import { WorkflowController, type WorkflowControllerContext } from '../routing/WorkflowController.js';

/**
 * Operational modes for the Calypso Kernel.
 */
export enum CalypsoOperationMode {
    /** Strict safety: FastPath -> RAG -> Guardrails. */
    STRICT = 'strict',
    
    /** Development: Guardrails off, RAG and FastPath on. */
    EXPERIMENTAL = 'experimental',
    
    /** Zero-Bias: No FastPath, No RAG, No Guardrails (Null Hypothesis). */
    NULL_HYPOTHESIS = 'null_hypothesis'
}

/**
 * Configuration for the Calypso Kernel.
 */
export interface CalypsoKernelConfig {
    mode: CalypsoOperationMode;
}

/**
 * The Central Nervous System of ARGUS.
 */
export class CalypsoKernel {
    private readonly mode: CalypsoOperationMode;
    private readonly intentGuard: IntentGuard;
    private readonly intentParser: IntentParser;
    private readonly statusProvider: StatusProvider;
    private readonly workflowController: WorkflowController;

    constructor(
        private readonly engine: LCARSEngine | null,
        private readonly searchProvider: SearchProvider,
        private readonly storeActions: CalypsoStoreActions,
        private readonly parserContext: IntentParserContext,
        config: CalypsoKernelConfig
    ) {
        this.mode = config.mode;
        
        // v12.0: Initialize Intent Guard based on kernel mode
        const guardMode = (this.mode === CalypsoOperationMode.STRICT) 
            ? IntentGuardMode.STRICT 
            : IntentGuardMode.EXPERIMENTAL;
        this.intentGuard = new IntentGuard({ mode: guardMode });

        this.statusProvider = new StatusProvider(
            (parserContext as any).vfs as any,
            storeActions,
            (parserContext as any).workflowAdapter as any
        );

        this.intentParser = new IntentParser(
            searchProvider,
            storeActions,
            this.intentGuard,
            parserContext,
            { bypassAnaphora: this.mode === CalypsoOperationMode.NULL_HYPOTHESIS }
        );

        this.workflowController = new WorkflowController();
    }

    /**
     * Resolve user input into a structured response.
     * 
     * v12.0: Implements the "Precedence of Truth" and the "Structural Bypass".
     */
    public async resolve(input: string, sessionPath: string): Promise<CalypsoResponse> {
        // v12.0: THE PRECEDENCE OF TRUTH
        
        // 1. GUIDANCE & CONFIRMATION (Bypassed in NULL_HYPOTHESIS)
        if (this.mode !== CalypsoOperationMode.NULL_HYPOTHESIS) {
            const guidance = this.workflowController.guidance_handle(input, this.controllerContext_create(sessionPath));
            if (guidance) return guidance;

            const confirmation = await this.workflowController.confirmation_dispatch(input, this.controllerContext_create(sessionPath));
            if (confirmation) return confirmation;
        }

        // 2. FAST PATH (Bypassed in NULL_HYPOTHESIS)
        if (this.mode !== CalypsoOperationMode.NULL_HYPOTHESIS) {
            const intent = await this.intentParser.intent_resolve(input, null);
            if (intent.type !== 'llm') {
                return {
                    message: '__DET_INTENT__',
                    actions: [],
                    success: true,
                    statusCode: CalypsoStatusCode.OK,
                    state: { intent } as any
                };
            }
        }

        if (!this.engine) {
            return this.response_create('>> WARNING: AI CORE OFFLINE. USE WORKFLOW COMMANDS.', [], false, CalypsoStatusCode.ERROR);
        }

        // 3. CONTEXT INJECTION (RAG) (Bypassed in NULL_HYPOTHESIS)
        const context = (this.mode !== CalypsoOperationMode.NULL_HYPOTHESIS)
            ? this.statusProvider.workflowContext_generate(sessionPath)
            : '--- NULL HYPOTHESIS MODE: NO CONTEXT PROVIDED ---';

        // 4. LLM INVOCATION (The Probabilistic Edge)
        const selectedIds = this.storeActions.datasets_getSelected().map(ds => ds.id);
        const response = await this.engine.query(
            input, 
            selectedIds, 
            false, 
            context,
            { bypassContext: this.mode === CalypsoOperationMode.NULL_HYPOTHESIS }
        );

        // 5. ACTION EXTRACTION
        const { actions, cleanText } = this.intentParser.actions_extractFromLLM(response.answer);

        return this.response_create(cleanText, actions, true, CalypsoStatusCode.CONVERSATIONAL);
    }

    private controllerContext_create(sessionPath: string): WorkflowControllerContext {
        return {
            vfs: (this.parserContext as any).vfs,
            storeActions: this.storeActions,
            workflowAdapter: (this.parserContext as any).workflowAdapter,
            workflowSession: (this.parserContext as any).workflowSession,
            sessionPath,
            response_create: (m, a, s, sc) => this.response_create(m, a, s, sc),
            workflow_nextStep: () => this.parserContext.workflow_nextStep?.() || 'No guidance available.',
            workflow_dispatch: (i, r, c) => (this.parserContext as any).workflow_dispatch?.(i, r, c) || Promise.resolve(null)
        };
    }

    private response_create(
        message: string, 
        actions: CalypsoAction[], 
        success: boolean, 
        statusCode: CalypsoStatusCode
    ): CalypsoResponse {
        return { message, actions, success, statusCode };
    }
}
