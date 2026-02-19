/**
 * @file LLM Provider
 *
 * Orchestrates LLM queries, processes responses into intents/actions,
 * and handles greeting/standby generation.
 *
 * @module lcarslm/llm
 */

import type { LCARSEngine } from './engine.js';
import type { StatusProvider } from './StatusProvider.js';
import type { SearchProvider } from './SearchProvider.js';
import type { CalypsoStoreActions, CalypsoResponse, CalypsoAction, QueryResponse } from './types.js';
import { IntentParser } from './routing/IntentParser.js';

export class LLMProvider {
    constructor(
        private readonly engine: LCARSEngine | null,
        private readonly status: StatusProvider,
        private readonly search: SearchProvider,
        private readonly store: CalypsoStoreActions,
        private readonly intentParser: IntentParser,
        private readonly responseCreator: (msg: string, actions: CalypsoAction[], success: boolean) => CalypsoResponse,
        private readonly commandExecutor: (cmd: string) => Promise<CalypsoResponse | null>
    ) {}

    /**
     * Query the LLM with system context.
     */
    public async query(input: string, sessionPath: string): Promise<CalypsoResponse> {
        // We only block if there is NO engine at all. 
        // LCARSEngine handles the simulationMode internal logic.
        if (!this.engine) {
            return this.responseCreator('>> WARNING: AI CORE OFFLINE. USE WORKFLOW COMMANDS.', [], false);
        }

        const selectedIds = this.store.datasets_getSelected().map(ds => ds.id);
        const context = this.status.workflowContext_generate(sessionPath);

        try {
            const response = await this.engine.query(input, selectedIds, false, context);
            return await this.response_process(response);
        } catch (e: unknown) {
            const errorMsg = e instanceof Error ? e.message : 'UNKNOWN ERROR';
            return this.responseCreator(`>> ERROR: AI QUERY FAILED. ${errorMsg}`, [], false);
        }
    }

    /**
     * Process LLM response and extract intents/actions.
     */
    private async response_process(response: QueryResponse): Promise<CalypsoResponse> {
        const { actions, cleanText } = this.intentParser.actions_extractFromLLM(response.answer);

        // TRIGGER MATERIALIZATION: If the AI decided to select a dataset or proceed,
        // we execute the corresponding deterministic command through the orchestrator.
        // This ensures the v9.0.0 DAG Engine sees the materialized artifacts.
        
        // 1. Check for [SELECT: ds-xxx]
        const selectMatches = Array.from(response.answer.matchAll(/\[SELECT: (ds-[0-9]+)\]/g));
        for (const match of selectMatches) {
            const dsId = match[1];
            await this.commandExecutor(`add ${dsId}`);
        }

        // 2. Check for [ACTION: PROCEED]
        const proceedMatch: RegExpMatchArray | null = response.answer.match(/\[ACTION: PROCEED(?:\s+(fedml|chris))?\]/i);
        if (proceedMatch) {
            const type: string = proceedMatch[1] || '';
            const cmd: string = `proceed ${type}`.trim();
            console.log(`[LLM] Triggering internal command: ${cmd}`);
            const result = await this.commandExecutor(cmd);
            if (result) return result;
        }

        // 3. Check for [ACTION: RENAME]
        const renameMatch = response.answer.match(/\[ACTION: RENAME\s+([^\]]+)\]/i);
        if (renameMatch) {
            const newName = renameMatch[1].trim();
            await this.commandExecutor(`rename ${newName}`);
        }

        // Special case: if harmonize action was detected (implied by side effect in parser),
        // we need to return the animation marker.
        if (response.answer.includes('[ACTION: HARMONIZE]')) {
            return this.responseCreator('__HARMONIZE_ANIMATE__', [], true);
        }

        return this.responseCreator(cleanText, actions, true);
    }

    /** Generate a personalized greeting */
    public async greeting_generate(username: string): Promise<CalypsoResponse> {
        if (!this.engine) return this.responseCreator(`WELCOME, ${username}. AI CORE OFFLINE.`, [], true);
        try {
            const response = await this.engine.query(`The user "${username}" just logged in. Greet them as CALYPSO. Include one interesting fact about the current data catalog. Keep it brief.`, [], true);
            return this.responseCreator(response.answer, [], true);
        } catch {
            return this.responseCreator(`WELCOME, ${username}. READY FOR INPUT.`, [], true);
        }
    }

    /** Generate a standby message */
    public async standby_generate(username: string): Promise<CalypsoResponse> {
        if (!this.engine) return this.responseCreator('○ SYSTEM STANDBY.', [], true);
        try {
            const response = await this.engine.query(`The user "${username}" is inactive. CALYPSO should say something brief to check in.`, [], true);
            return this.responseCreator(response.answer, [], true);
        } catch {
            return this.responseCreator('○ SYSTEM STANDBY.', [], true);
        }
    }
}
