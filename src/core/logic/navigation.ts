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
import type { AppState } from '../models/types.js';

/** Tracks which SeaGaP stages have been visited for back-navigation. */
export const visitedStages: Set<string> = new Set();

/** Ordered list of SeaGaP stages for navigation logic. */
export const STAGE_ORDER: readonly string[] = ['search', 'gather', 'process', 'monitor', 'post'] as const;

// ============================================================================
// Event Listeners
// ============================================================================

events.on(Events.STAGE_CHANGED, (newStage: AppState['currentStage']): void => {
    stageIndicators_update(newStage);
    stageContent_update(newStage);
    lockState_update(newStage);
    stations_update(newStage);

    document.dispatchEvent(new CustomEvent('argus:stage-change', { detail: { stage: newStage } }));
    if (globals.terminal) globals.terminal.prompt_sync();

    if (newStage === 'gather') {
        gutter_setStatus(2, 'active');
    } else if (newStage === 'process') {
        gutter_setStatus(3, 'active');
    } else if (newStage === 'monitor') {
        gutter_setStatus(4, 'active');
    } else if (newStage === 'post') {
        gutter_setStatus(5, 'active');
    } else {
        gutter_setStatus(1, 'active');
    }
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Toggles the 'active' class on stage indicator elements
 * to highlight the current stage.
 *
 * @param stageName - The active stage identifier.
 */
function stageIndicators_update(stageName: string): void {
    document.querySelectorAll('.stage-indicator').forEach((indicator: Element): void => {
        const indicatorStage: string | null = indicator.getAttribute('data-stage');
        indicator.classList.toggle('active', indicatorStage === stageName);
    });
}

/**
 * Toggles the 'active' class on stage content panels
 * to show the current stage's UI.
 *
 * @param stageName - The active stage identifier.
 */
function stageContent_update(stageName: string): void {
    document.querySelectorAll('.stage-content').forEach((content: Element): void => {
        const contentStage: string | null = content.getAttribute('data-stage');
        content.classList.toggle('active', contentStage === stageName);
    });
}

/**
 * Manages the body lock state and lock panel element.
 * Locks the UI during login/role-selection stages.
 *
 * @param stageName - The active stage identifier.
 */
function lockState_update(stageName: string): void {
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
 * Marks the current station as active and previously visited ones as visited.
 *
 * @param currentStage - The current SeaGaP stage.
 */
function stations_update(currentStage: AppState['currentStage']): void {
    if (STAGE_ORDER.includes(currentStage)) {
        visitedStages.add(currentStage);
    }

    STAGE_ORDER.forEach((stageName: string): void => {
        const station: HTMLElement | null = document.getElementById(`station-${stageName}`);
        if (!station) return;

        const isActive: boolean = stageName === currentStage;
        const isVisited: boolean = visitedStages.has(stageName) && !isActive;

        station.classList.toggle('active', isActive);
        station.classList.toggle('visited', isVisited);
    });
}

// ============================================================================
// Exported Navigation Functions
// ============================================================================

/**
 * Advances to a specific SeaGaP-MP stage.
 * Uses the Store to trigger the state change event.
 *
 * @param stageName - The target stage.
 */
export function stage_advanceTo(stageName: AppState['currentStage']): void {
    store.stage_set(stageName);
}

/**
 * Handles click on a station for back-navigation.
 * Only allows navigation to previously visited stages.
 *
 * @param stageName - The stage to navigate to.
 */
export function station_click(stageName: string): void {
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
 * Enables or disables a stage indicator button.
 *
 * @param stageName - The stage to enable/disable.
 * @param enabled - Whether to enable the indicator.
 */
export function stageButton_setEnabled(stageName: string, enabled: boolean): void {
    const indicator: HTMLElement | null = document.querySelector(`.stage-indicator[data-stage="${stageName}"]`) as HTMLElement;
    if (indicator) {
        indicator.classList.toggle('disabled', !enabled);
    }
}

/**
 * Initializes click handlers on all stage indicator elements.
 */
export function stageIndicators_initialize(): void {
    document.querySelectorAll('.stage-indicator').forEach((indicator: Element): void => {
        indicator.addEventListener('click', (): void => {
            const stage: string | null = indicator.getAttribute('data-stage');
            if (stage && !indicator.classList.contains('disabled')) {
                stage_advanceTo(stage as AppState['currentStage']);
            }
        });
    });
}
