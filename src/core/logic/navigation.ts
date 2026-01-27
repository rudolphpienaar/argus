/**
 * @file Navigation Logic
 * 
 * Manages the SeaGaP-MP workflow state and stage transitions.
 * 
 * @module
 */

import { state, globals } from '../state/store.js';
import { cascade_update } from './telemetry.js';
import { gutter_setStatus } from '../../ui/gutters.js';
import { filesystem_build, costs_calculate } from '../stages/gather.js';
import { monitor_initialize } from '../stages/monitor.js';
import { populate_ide } from '../stages/process.js';
import type { AppState } from '../models/types.js';

/** Tracks which SeaGaP stages have been visited for back-navigation */
export const visitedStages: Set<string> = new Set();

/** Ordered list of SeaGaP stages for navigation logic */
export const STAGE_ORDER: readonly string[] = ['search', 'gather', 'process', 'monitor', 'post'] as const;

/**
 * Updates the visual state of all SeaGaP stations.
 *
 * @param currentStage - The currently active stage
 */
function stations_update(currentStage: AppState['currentStage']): void {
    // Mark current stage as visited
    if (STAGE_ORDER.includes(currentStage)) {
        visitedStages.add(currentStage);
    }

    // Update each station's visual state
    STAGE_ORDER.forEach((stageName: string) => {
        const station: HTMLElement | null = document.getElementById(`station-${stageName}`);
        if (!station) return;

        const isActive: boolean = stageName === currentStage;
        const isVisited: boolean = visitedStages.has(stageName) && !isActive;

        station.classList.toggle('active', isActive);
        station.classList.toggle('visited', isVisited);
    });

    // Start global telemetry ticker (if not already running)
    // We need to import stationTelemetry_start or move it here. 
    // It's currently in argus.ts. For now, we'll expose a hook or assume argus handles the ticker start.
    // Actually, stationTelemetry_start depends on DOM elements update, which happens here.
    // Let's assume the ticker is running globally.
}

/**
 * Advances to a specific SeaGaP-MP stage.
 *
 * @param stageName - The target stage name
 */
export function stage_advanceTo(stageName: AppState['currentStage']): void {
    state.currentStage = stageName;

    // Update stage indicators in sidebar
    document.querySelectorAll('.stage-indicator').forEach((indicator: Element) => {
        const indicatorStage: string | null = indicator.getAttribute('data-stage');
        indicator.classList.toggle('active', indicatorStage === stageName);
    });

    // Show/hide stage content
    document.querySelectorAll('.stage-content').forEach((content: Element) => {
        const contentStage: string | null = content.getAttribute('data-stage');
        content.classList.toggle('active', contentStage === stageName);
    });

    // Sidebar and Header management
    const isUnlocked: boolean = stageName !== 'login' && stageName !== 'role-selection';
    
    if (isUnlocked) {
        document.body.classList.remove('state-locked');
    } else {
        document.body.classList.add('state-locked');
    }

    // Update SeaGaP station states
    stations_update(stageName);

    const sidebarStages: HTMLElement | null = document.querySelector('.sidebar-panels') as HTMLElement;
    
    // Add "LOCKED" panel for login if needed
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

    // Update cascade status
    cascade_update();

    // Update Terminal Visibility and Prompt
    // FIXME: This tightly couples navigation to the terminal UI. 
    // Ideally this should be an event or a separate UI update function.
    // For now, we'll do a simple DOM check or dispatch an event.
    // Since we don't have the `terminal` instance here, we must rely on DOM or global.
    // We will emit a custom event that argus.ts listens to for terminal updates.
    document.dispatchEvent(new CustomEvent('argus:stage-change', { detail: { stage: stageName } }));

    // Stage-specific initialization
    if (stageName === 'gather') {
        filesystem_build();
        costs_calculate();
        gutter_setStatus(2, 'active');
        if (globals.terminal) globals.terminal.updatePrompt();
    } else if (stageName === 'process') {
        populate_ide();
        gutter_setStatus(3, 'active');
        if (globals.terminal) globals.terminal.updatePrompt();
    } else if (stageName === 'monitor') {
        setTimeout(monitor_initialize, 50);
        gutter_setStatus(4, 'active');
    } else if (stageName === 'post') {
        gutter_setStatus(5, 'active');
    } else {
        gutter_setStatus(1, 'active');
    }
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
