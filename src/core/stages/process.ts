/**
 * @file Process Stage Logic
 * 
 * Manages the developer terminal interactions and environment.
 * 
 * @module
 */

import { state, globals } from '../state/store.js';
import { dataset_toggle, workspace_render } from './search.js';
import { stage_next, stage_advanceTo, stageButton_setEnabled } from '../logic/navigation.js';
import type { QueryResponse } from '../../lcarslm/types.js';
import type { Dataset } from '../models/types.js';
import { MOCK_NODES } from '../data/nodes.js';

/**
 * Handles unrecognized terminal commands by routing them to the AI core.
 */
export async function terminal_handleCommand(cmd: string, args: string[]): Promise<void> {
    if (!globals.terminal) return;

    // Local Command Handling (Stub for now)
    if (cmd === 'cd' || cmd === 'ls') {
        // ... (We will move the detailed cd/ls logic here in a moment)
        // For now, pass to AI if not handled by Terminal internal logic? 
        // Actually, Terminal.ts handles ls/cd internally for the VFS. 
        // But we added custom logic for Project Navigation in argus.ts.
        // We need to replicate that here.
        return handleProjectNavigation(cmd, args);
    }

    const query: string = [cmd, ...args].join(' ');
    
    if (globals.lcarsEngine) {
        globals.terminal.println('○ CONTACTING AI CORE... PROCESSING...');
        try {
            const selectedIds: string[] = state.selectedDatasets.map((ds: Dataset) => ds.id);
            const response: QueryResponse = await globals.lcarsEngine.query(query, selectedIds);
            
            // 1. Process Intent: [SELECT: ds-xxx]
            const selectMatch = response.answer.match(/\[SELECT: (ds-[0-9]+)\]/);
            if (selectMatch) {
                const datasetId = selectMatch[1];
                dataset_toggle(datasetId);
                globals.terminal.println(`● AFFIRMATIVE. DATASET [${datasetId}] SELECTED AND ADDED TO SESSION BUFFER.`);
            }

            // 2. Process Intent: [ACTION: PROCEED]
            if (response.answer.includes('[ACTION: PROCEED]')) {
                globals.terminal.println('● AFFIRMATIVE. PREPARING GATHER PROTOCOL.');
                setTimeout(stage_next, 1000);
            }

            // 3. Clean and Print
            const cleanAnswer = response.answer
                .replace(/\[SELECT: ds-[0-9]+\]/g, '')
                .replace(/\[ACTION: PROCEED\]/g, '')
                .trim();

            globals.terminal.println(`<span class="highlight">${cleanAnswer}</span>`);
            
            if (state.currentStage === 'search') {
                workspace_render(response.relevantDatasets, true);
            }
        } catch (e: any) {
            globals.terminal.println(`<span class="error">>> ERROR: UNABLE TO ESTABLISH LINK. ${e.message}</span>`);
        }
    } else {
        globals.terminal.println(`<span class="warn">>> COMMAND NOT RECOGNIZED. AI CORE OFFLINE.</span>`);
    }
}

async function handleProjectNavigation(cmd: string, args: string[]): Promise<void> {
    // This logic needs to be moved from argus.ts.
    // I will implement it fully in the next step to ensure clean imports.
}

export function terminal_toggle(): void {
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');
    if (consoleEl) {
        const isOpen: boolean = consoleEl.classList.contains('open');
        if (isOpen) {
            consoleEl.classList.remove('open');
            consoleEl.style.height = '';
        } else {
            consoleEl.classList.add('open');
            if (!consoleEl.style.height) {
                consoleEl.style.height = '600px';
            }
        }
    }
}

export function terminal_initializeDraggable(): void {
    const strip: HTMLElement | null = document.getElementById('access-strip');
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');
    
    if (!strip || !consoleEl) return;

    let isDragging: boolean = false;
    let startY: number = 0;
    let startHeight: number = 0;

    strip.addEventListener('mousedown', (e: MouseEvent) => {
        isDragging = true;
        startY = e.clientY;
        startHeight = consoleEl.offsetHeight;
        strip.classList.add('active');
        document.body.style.cursor = 'ns-resize';
        if (!consoleEl.classList.contains('open')) {
            consoleEl.classList.add('open');
        }
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isDragging) return;
        const deltaY: number = e.clientY - startY;
        const newHeight: number = Math.max(0, Math.min(window.innerHeight - 400, startHeight + deltaY));
        consoleEl.style.height = `${newHeight}px`;
        consoleEl.style.transition = 'none';
        
        if (newHeight > 50) {
            consoleEl.classList.add('open');
        } else {
            consoleEl.classList.remove('open');
        }
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        strip.classList.remove('active');
        document.body.style.cursor = 'default';
        consoleEl.style.transition = '';
    });
}

/**
 * Launches federated training.
 */
export function training_launch(): void {
    // If already running, ignore
    if (state.trainingJob && state.trainingJob.status === 'running') return;

    // Initialize training job
    state.trainingJob = {
        id: `job-${Date.now()}`,
        status: 'running',
        currentEpoch: 0,
        totalEpochs: 50,
        loss: 2.5,
        accuracy: 0,
        auc: 0,
        runningCost: 0,
        budgetLimit: 500,
        startTime: new Date(),
        nodes: JSON.parse(JSON.stringify(MOCK_NODES)),
        lossHistory: []
    };

    stageButton_setEnabled('monitor', true);
    stage_advanceTo('monitor');
}