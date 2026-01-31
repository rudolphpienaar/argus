/**
 * @file Command Logic
 *
 * Handles terminal command routing and execution.
 * Dispatches known workflow commands (search, mount, etc.) and falls back
 * to the AI service for natural language queries.
 *
 * @module
 */

import { globals } from '../state/store.js';
import { DATASETS } from '../data/datasets.js';
import type { Dataset } from '../models/types.js';
import { stage_advanceTo } from './navigation.js';
import { catalog_search, dataset_toggle, lcarslm_simulate } from '../stages/search.js';
import { filesystem_build, costs_calculate } from '../stages/gather.js';
import { ai_query } from '../../lcarslm/AIService.js';

/**
 * Handles workflow commands typed into the terminal.
 * Routes search, add, review, mount, and simulate commands
 * before falling through to the AI engine for natural language queries.
 *
 * @param cmd - The base command string.
 * @param args - The command arguments.
 */
export async function command_dispatch(cmd: string, args: string[]): Promise<void> {
    const t = globals.terminal;
    if (!t) return;

    if (workflow_dispatch(cmd, args)) return;

    await ai_query([cmd, ...args].join(' '));
}

/**
 * Handles known workflow commands (search, add, review, mount, simulate).
 *
 * @param cmd - The command string.
 * @param args - The command arguments.
 * @returns True if the command was handled, false to fall through.
 */
function workflow_dispatch(cmd: string, args: string[]): boolean {
    const t = globals.terminal;
    if (!t) return false;

    if (cmd === 'search') {
        const query: string = args.join(' ');
        t.println(`○ SEARCHING CATALOG FOR: "${query}"...`);
        stage_advanceTo('search');
        const searchInput: HTMLInputElement | null = document.getElementById('search-query') as HTMLInputElement;
        if (searchInput) {
            searchInput.value = query;
            catalog_search(query).then((results: Dataset[]): void => {
                if (results && results.length > 0) {
                    t.println(`● FOUND ${results.length} MATCHING DATASETS:`);
                    results.forEach((ds: Dataset): void => {
                        t.println(`  [<span class="highlight">${ds.id}</span>] ${ds.name} (${ds.modality}/${ds.annotationType})`);
                    });
                } else {
                    t.println(`○ NO MATCHING DATASETS FOUND.`);
                }
            });
        }
        return true;
    }

    if (cmd === 'add') {
        const targetId: string = args[0];
        const dataset: Dataset | undefined = DATASETS.find((ds: Dataset): boolean => ds.id === targetId || ds.name.toLowerCase().includes(targetId.toLowerCase()));
        if (dataset) {
            dataset_toggle(dataset.id);
        } else {
            t.println(`<span class="error">>> ERROR: DATASET "${targetId}" NOT FOUND.</span>`);
        }
        return true;
    }

    if (cmd === 'review' || cmd === 'gather') {
        t.println(`● INITIATING COHORT REVIEW...`);
        stage_advanceTo('gather');
        return true;
    }

    if (cmd === 'mount') {
        t.println(`● MOUNTING VIRTUAL FILESYSTEM...`);
        filesystem_build();
        costs_calculate();
        stage_advanceTo('process');
        t.println(`<span class="success">>> MOUNT COMPLETE. FILESYSTEM READY.</span>`);
        return true;
    }

    if (cmd === 'simulate') {
        t.println(`● ACTIVATING SIMULATION PROTOCOLS...`);
        lcarslm_simulate();
        return true;
    }

    return false;
}
