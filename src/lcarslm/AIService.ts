/**
 * @file AI Service
 *
 * Orchestrates interactions with the LCARSEngine (RAG/LLM).
 * Handles query execution, response processing, and system action triggers.
 *
 * @module
 */

import { state, globals, store } from '../core/state/store.js';
import type { Dataset } from '../core/models/types.js';
import type { QueryResponse } from './types.js';
import { dataset_select, workspace_render } from '../core/stages/search.js';
import { stage_next } from '../core/logic/navigation.js';

/**
 * Handles natural language queries by routing to the active AI engine.
 *
 * @param query - The full query string.
 */
export async function ai_query(query: string): Promise<void> {
    const t = globals.terminal;
    if (!t) return;

    if (globals.lcarsEngine) {
        t.println('○ CONTACTING AI CORE... PROCESSING...');
        try {
            const selectedIds: string[] = state.selectedDatasets.map((ds: Dataset): string => ds.id);
            const response: QueryResponse = await globals.lcarsEngine.query(query, selectedIds);

            aiResponse_process(response);
        } catch (e: unknown) {
            const errorMsg: string = (e instanceof Error ? e.message : 'UNKNOWN ERROR').toLowerCase();

            if (errorMsg.includes('quota') || errorMsg.includes('exceeded') || errorMsg.includes('429')) {
                t.println(`<span class="error">>> ERROR: RESOURCE QUOTA EXCEEDED. RATE LIMIT ACTIVE.</span>`);
                t.println(`<span class="warn">>> STANDBY. RETRY IN 30-60 SECONDS.</span>`);
                t.println(`<span class="dim">   (Or type "simulate" to force offline mode)</span>`);
            } else {
                t.println(`<span class="error">>> ERROR: UNABLE TO ESTABLISH LINK. ${errorMsg}</span>`);
            }
        }
    } else {
        t.println(`<span class="warn">>> COMMAND NOT RECOGNIZED. AI CORE OFFLINE.</span>`);
        t.println(`<span class="dim">>> SYSTEM UNINITIALIZED. PLEASE AUTHENTICATE OR TYPE "simulate".</span>`);
    }
}

/**
 * Processes an AI query response — handling select intents, action directives,
 * and dataset filtering.
 *
 * @param response - The AI query response.
 */
function aiResponse_process(response: QueryResponse): void {
    const t = globals.terminal;
    if (!t) return;

    const selectMatch: RegExpMatchArray | null = response.answer.match(/\[SELECT: (ds-[0-9]+)\]/);
    if (selectMatch) {
        const datasetId: string = selectMatch[1];

        if (state.activeProject) {
            t.println(`○ RESETTING PROJECT CONTEXT [${state.activeProject.name}] FOR NEW SELECTION.`);
            store.project_unload();
            workspace_render([], true); // Render empty search results to clear previous context
        }

        dataset_select(datasetId);
        t.println(`● AFFIRMATIVE. DATASET [${datasetId}] SELECTED AND ADDED TO SESSION BUFFER.`);
    }

    if (response.answer.includes('[ACTION: PROCEED]')) {
        t.println('● AFFIRMATIVE. PREPARING GATHER PROTOCOL.');
        setTimeout(stage_next, 1000);
    }

    const cleanAnswer: string = response.answer
        .replace(/\[SELECT: ds-[0-9]+\]/g, '')
        .replace(/\[ACTION: PROCEED\]/g, '')
        .replace(/\[ACTION: SHOW_DATASETS\]/g, '')
        .replace(/\[FILTER:.*?\]/g, '')
        .trim();

    t.println(`<span class="highlight">${cleanAnswer}</span>`);

    if (state.currentStage === 'search' && response.answer.includes('[ACTION: SHOW_DATASETS]')) {
        let datasetsToShow: Dataset[] = response.relevantDatasets;

        const filterMatch: RegExpMatchArray | null = response.answer.match(/\[FILTER: (.*?)\]/);
        if (filterMatch) {
            const ids: string[] = filterMatch[1].split(',').map((s: string): string => s.trim());
            datasetsToShow = datasetsToShow.filter((ds: Dataset): boolean => ids.includes(ds.id));
        }

        workspace_render(datasetsToShow, true);
    }
}
