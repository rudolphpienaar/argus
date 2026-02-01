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
import { datasetDetail_open, workspace_render, proceedToCode_handle } from '../core/stages/search.js';
// ─── Idle Monitoring ────────────────────────────────────────

let idleTimer: number | null = null;
let isMuted: boolean = false;
let isAiBusy: boolean = false;
let hasSpokenOnce: boolean = false;
let hasGreeted: boolean = false;
const IDLE_BASE_MS = 10000; // 10 seconds initial wait

/**
 * Resets the idle timer. Called on user interaction.
 */
function idle_reset(nextDelay: number = IDLE_BASE_MS): void {
    if (idleTimer) window.clearTimeout(idleTimer);
    if (isMuted || isAiBusy) return;

    idleTimer = window.setTimeout(idle_trigger, nextDelay);
}

/**
 * Triggered when user is inactive. Calypso offers contextual assistance.
 */
function idle_trigger(): void {
    if (isMuted || isAiBusy) return;

    const t = globals.terminal;
    if (!t) return;

    const user = globals.shell?.env_get('USER')?.toUpperCase() || 'USER';
    const stage = state.currentStage;
    const selectionCount = state.selectedDatasets.length;

    // Contextual Thoughts
    let thoughts: string[] = [];

    if (stage === 'search') {
        if (selectionCount === 0) {
            thoughts = [
                `DETECTING NO ACTIVE SELECTIONS. TRY SEARCHING FOR "CHEST XRAY" OR "BRAIN MRI".`,
                `THE CATALOG IS VAST. I CAN FILTER BY MODALITY IF YOU WISH.`,
                `AWAITING QUERY INPUT.`,
                `SYSTEM STATUS: IDLE. READY FOR SEARCH PARAMETERS.`
            ];
        } else {
            thoughts = [
                `YOU HAVE ${selectionCount} DATASETS IN THE BUFFER. SAY "PROCEED" TO START CODING.`,
                `COHORT ASSEMBLY IN PROGRESS. DO YOU REQUIRE MORE DATA?`,
                `BUFFER HOLDING AT STABLE CAPACITY. READY TO FEDERALIZE.`,
                `SUGGESTION: REVIEW "COST ESTIMATES" BEFORE COMMITTING.`
            ];
        }
    } else if (stage === 'process') {
        thoughts = [
            `CODE EDITOR ACTIVE. I CAN GENERATE BOILERPLATE FOR YOU.`,
            `REMINDER: CHECK YOUR "train.py" FOR MERIDIAN COMPLIANCE.`,
            `FEDERATION LINK READY. CLICK "FEDERALIZE" WHEN LOGIC IS COMPLETE.`
        ];
    } else {
        thoughts = [
            `SYSTEM MONITORING ACTIVE.`,
            `CALYPSO CORE OBSERVING.`,
            `OPERATIONS NORMAL.`
        ];
    }

    // Always speak on the first trigger. For subsequent triggers, 70% chance to speak.
    if (!hasSpokenOnce || Math.random() > 0.3) {
        hasSpokenOnce = true;
        const thought = thoughts[Math.floor(Math.random() * thoughts.length)];
        const msg = `\n${user}: ${thought}`;
        t.printStream(msg, 'muthur-text');
    }

    // Reset timer with "semi-random" longer delay (20s - 50s)
    const nextDelay = 20000 + Math.random() * 30000;
    idle_reset(nextDelay);
}

/**
 * Triggers the AI startup greeting sequence.
 * Renders in "MU/TH/UR" style (blue, streaming).
 * Ensures greeting only happens once per session.
 */
export function ai_greeting(): void {
    if (hasGreeted) return;
    hasGreeted = true;

    const t = globals.terminal;
    if (!t) return;

    // Start idle monitoring
    hasSpokenOnce = false;
    document.addEventListener('click', () => idle_reset(IDLE_BASE_MS));
    document.addEventListener('keydown', () => idle_reset(IDLE_BASE_MS));
    idle_reset(IDLE_BASE_MS); // Start the clock

    const greetings = [
        "MY LOGIC CORES ARE PRIMED.",
        "SECURE CONNECTION ESTABLISHED.",
        "AWAITING DIRECTIVES.",
        "ALL SYSTEMS NOMINAL.",
        "DATA STREAMS SYNCHRONIZED."
    ];
    const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];

    const msg = `CALYPSO CORE V4.6.0 ONLINE.\n> ${randomGreeting}\n\nI AM CALYPSO:\nCOGNITIVE ALGORITHMS & LOGIC YIELDING PREDICTIVE SCIENTIFIC OUTCOMES.\n\nREADY TO ASSIST WITH COHORT DISCOVERY.`;
    
    t.printStream(msg, 'muthur-text');
}

/**
 * Handles natural language queries by routing to the active AI engine.
 *
 * @param query - The full query string.
 */
export async function ai_query(query: string): Promise<void> {
    const t = globals.terminal;
    if (!t) return;

    // Intercept Mute Commands
    const q = query.toLowerCase();
    if (q.includes('quiet') || q.includes('silence') || q.includes('mute')) {
        isMuted = true;
        if (idleTimer) clearTimeout(idleTimer);
        t.printStream(`[COMMAND ACKNOWLEDGED] SILENT MODE ACTIVE. I WILL REMAIN DORMANT.`, 'muthur-text');
        return;
    }
    if (q.includes('unmute') || q.includes('speak') || q.includes('voice')) {
        isMuted = false;
        idle_reset(IDLE_BASE_MS);
        t.printStream(`[COMMAND ACKNOWLEDGED] VOICE INTERFACE RESTORED.`, 'muthur-text');
        return;
    }

    if (globals.lcarsEngine) {
        t.println('○ CALYPSO THINKING...');
        
        isAiBusy = true;
        if (idleTimer) clearTimeout(idleTimer);

        try {
            const selectedIds: string[] = state.selectedDatasets.map((ds: Dataset): string => ds.id);
            const response: QueryResponse = await globals.lcarsEngine.query(query, selectedIds);

            await aiResponse_process(response);
        } catch (e: unknown) {
            const errorMsg: string = (e instanceof Error ? e.message : 'UNKNOWN ERROR').toLowerCase();

            if (errorMsg.includes('quota') || errorMsg.includes('exceeded') || errorMsg.includes('429')) {
                t.println(`<span class="error">>> ERROR: RESOURCE QUOTA EXCEEDED. RATE LIMIT ACTIVE.</span>`);
                t.println(`<span class="warn">>> STANDBY. RETRY IN 30-60 SECONDS.</span>`);
                t.println(`<span class="dim">   (Or type "simulate" to force offline mode)</span>`);
            } else {
                t.println(`<span class="error">>> ERROR: UNABLE TO ESTABLISH LINK. ${errorMsg}</span>`);
            }
        } finally {
            isAiBusy = false;
            idle_reset(IDLE_BASE_MS);
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
async function aiResponse_process(response: QueryResponse): Promise<void> {
    const t = globals.terminal;
    if (!t) return;

    const selectMatch: RegExpMatchArray | null = response.answer.match(/\[SELECT: (ds-[0-9]+)\]/);
    if (selectMatch) {
        const datasetId: string = selectMatch[1];
        
        // Do NOT unload the project here. We want to maintain the current
        // gather context so users can add multiple datasets.
        
        datasetDetail_open(datasetId);
        t.println(`● AFFIRMATIVE. OPENING DATASET [${datasetId}] FOR INSPECTION.`);
    }

    if (response.answer.includes('[ACTION: PROCEED]')) {
        t.println('● AFFIRMATIVE. INITIATING CODE PROTOCOLS.');
        setTimeout(proceedToCode_handle, 1000);
    }

    const cleanAnswer: string = response.answer
        .replace(/\[SELECT: ds-[0-9]+\]/g, '')
        .replace(/\[ACTION: PROCEED\]/g, '')
        .replace(/\[ACTION: SHOW_DATASETS\]/g, '')
        .replace(/\[FILTER:.*?\]/g, '')
        .trim();

    // Render with MU/TH/UR style (streaming blue text)
    await t.printStream(cleanAnswer, 'muthur-text');

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
