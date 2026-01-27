/**
 * @file Navigation Logic
 * 
 * Manages the SeaGaP-MP workflow state and stage transitions.
 * 
 * @module
 */

import { state, globals, store } from '../state/store.js';
import { events, Events } from '../state/events.js';
import { gutter_setStatus } from '../../ui/gutters.js';
import { filesystem_build, costs_calculate } from '../stages/gather.js';
import { monitor_initialize } from '../stages/monitor.js';
import { populate_ide } from '../stages/process.js';
import type { AppState } from '../models/types.js';

/** Tracks which SeaGaP stages have been visited for back-navigation */
export const visitedStages: Set<string> = new Set();

/** Ordered list of SeaGaP stages for navigation logic */
export const STAGE_ORDER: readonly string[] = ['search', 'gather', 'process', 'monitor', 'post'] as const;

// --- Event Listeners ---

events.on(Events.STAGE_CHANGED, (newStage) => {
    // 1. Visual Updates
    updateStageIndicators(newStage);
    updateStageContent(newStage);
    updateLockState(newStage);
    stations_update(newStage);
    
    // 2. Terminal Updates
    document.dispatchEvent(new CustomEvent('argus:stage-change', { detail: { stage: newStage } }));
    if (globals.terminal) globals.terminal.updatePrompt();

    // 3. Stage-Specific Logic
    if (newStage === 'gather') {
        filesystem_build();
        costs_calculate();
        gutter_setStatus(2, 'active');
    } else if (newStage === 'process') {
        populate_ide();
        gutter_setStatus(3, 'active');
    } else if (newStage === 'monitor') {
        setTimeout(monitor_initialize, 50);
        gutter_setStatus(4, 'active');
    } else if (newStage === 'post') {
        gutter_setStatus(5, 'active');
    } else {
        gutter_setStatus(1, 'active');
    }
});

// --- Helper Functions ---

function updateStageIndicators(stageName: string) {
    document.querySelectorAll('.stage-indicator').forEach((indicator: Element) => {
        const indicatorStage: string | null = indicator.getAttribute('data-stage');
        indicator.classList.toggle('active', indicatorStage === stageName);
    });
}

function updateStageContent(stageName: string) {
    document.querySelectorAll('.stage-content').forEach((content: Element) => {
        const contentStage: string | null = content.getAttribute('data-stage');
        content.classList.toggle('active', contentStage === stageName);
    });
}

function updateLockState(stageName: string) {
    const isUnlocked: boolean = stageName !== 'login' && stageName !== 'role-selection';
    if (isUnlocked) {
        document.body.classList.remove('state-locked');
    } else {
        document.body.classList.add('state-locked');
    }
    
    const sidebarStages: HTMLElement | null = document.querySelector('.sidebar-panels') as HTMLElement;
    let lockPanel: HTMLElement | null = document.getElementById('lock-panel');
    if (!isUnlocked) {
        if (!lockPanel && sidebarStages && sidebarStages.parentElement) {
            lockPanel = document.createElement('div');
            lockPanel.id = 'lock-panel';
            lockPanel.className = 'panel-3 stage-indicator active';
            lockPanel.innerHTML = 'ACCESS<span class="hop">-LOCKED</span>';
            sidebarStages.parentElement.insertBefore(lockPanel, sidebarStages);
        }
    } else {
        if (lockPanel) lockPanel.remove();
    }
}

/**
 * Updates the visual state of all SeaGaP stations.
 */
function stations_update(currentStage: AppState['currentStage']): void {
    if (STAGE_ORDER.includes(currentStage)) {
        visitedStages.add(currentStage);
    }

    STAGE_ORDER.forEach((stageName: string) => {
        const station: HTMLElement | null = document.getElementById(`station-${stageName}`);
        if (!station) return;

        const isActive: boolean = stageName === currentStage;
        const isVisited: boolean = visitedStages.has(stageName) && !isActive;

        station.classList.toggle('active', isActive);
        station.classList.toggle('visited', isVisited);
    });
}

/**
 * Advances to a specific SeaGaP-MP stage.
 * Uses the Store to trigger the state change event.
 */
export function stage_advanceTo(stageName: AppState['currentStage']): void {
    store.setStage(stageName);
}

/**
 * Handles click on a station for back-navigation.
 *
 * @param stageName - The stage to navigate to
 */
export function station_click(stageName: string): void {
    // Only allow navigation to visited stages (back-navigation)
    if (visitedStages.has(stageName)) {
        stage_advanceTo(stageName as AppState['currentStage']);
    }
}

/**
 * Advances to the next stage in the SeaGaP workflow.
 */
export function stage_next(): void {
    const currentIndex: number = STAGE_ORDER.indexOf(state.currentStage);
    if (currentIndex === -1 || currentIndex >= STAGE_ORDER.length - 1) return;

    const nextStage: string = STAGE_ORDER[currentIndex + 1];
    stage_advanceTo(nextStage as AppState['currentStage']);
}

/**
 * Enables or disables a stage indicator.
 *
 * @param stageName - The stage to enable/disable
 * @param enabled - Whether to enable the indicator
 */
export function stageButton_setEnabled(stageName: string, enabled: boolean): void {
    const indicator = document.querySelector(`.stage-indicator[data-stage="${stageName}"]`) as HTMLElement;
    if (indicator) {
        indicator.classList.toggle('disabled', !enabled);
    }
}

/**
 * Initializes stage indicator click handlers.
 */
export function stageIndicators_initialize(): void {
    document.querySelectorAll('.stage-indicator').forEach(indicator => {
        indicator.addEventListener('click', () => {
            const stage = indicator.getAttribute('data-stage') as AppState['currentStage'];
            if (stage && !indicator.classList.contains('disabled')) {
                stage_advanceTo(stage);
            }
        });
    });
}
