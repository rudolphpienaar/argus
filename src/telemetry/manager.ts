/**
 * @file Telemetry Manager
 * Orchestrates the dashboard updates based on the current application stage.
 */

import type { AppState, Dataset, CostEstimate } from '../core/models/types.js';
import * as SystemTelemetry from './system.js';
import * as MetricsDashboard from './metrics.js';

let updateInterval: number | null = null;
let currentStage: AppState['currentStage'] = 'login';

/**
 * Starts the telemetry loop.
 */
export function telemetry_start(): void {
    if (updateInterval) return;
    updateInterval = window.setInterval(tick, 500);
}

/**
 * Stops the telemetry loop.
 */
export function telemetry_stop(): void {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    MetricsDashboard.ticker_stop();
}

/**
 * Updates the current stage context for the manager.
 * @param stage - The new application stage.
 */
export function stage_set(stage: AppState['currentStage']): void {
    currentStage = stage;
    viewVisibility_update();
}

/**
 * Main update loop.
 */
function tick(): void {
    // Only run high-frequency updates (System Telemetry) if the view is visible
    if (['login', 'role-selection', 'process', 'monitor'].includes(currentStage)) {
        const isProcess: boolean = currentStage === 'process';
        SystemTelemetry.processList_render(isProcess);
        SystemTelemetry.networkStats_render();
        SystemTelemetry.systemLogs_render();
    }
    // Metrics dashboard has its own internal ticker for the "Search" stage managed in metrics.ts
}

/**
 * Toggles the visibility of the dashboard containers based on the stage.
 */
function viewVisibility_update(): void {
    const viewMetrics: HTMLElement | null = document.getElementById('view-metrics');
    const viewTelemetry: HTMLElement | null = document.getElementById('telemetry-dashboard');

    if (['login', 'role-selection', 'process', 'monitor'].includes(currentStage)) {
        // Show Telemetry
        if (viewMetrics) viewMetrics.classList.add('hidden');
        if (viewTelemetry) viewTelemetry.classList.remove('hidden');
    } else {
        // Show Metrics
        if (viewMetrics) viewMetrics.classList.remove('hidden');
        if (viewTelemetry) viewTelemetry.classList.add('hidden');
        
        // Trigger initial render for static/low-freq metric views
        // Note: Search stage has an internal ticker started by searchMetrics_render
    }
}

/**
 * Forces a refresh of the metrics dashboard (e.g., when selection changes).
 */
export function metrics_refresh(selectedDatasets: Dataset[], costEstimate: CostEstimate): void {
    if (currentStage === 'search') {
        MetricsDashboard.searchMetrics_render(selectedDatasets);
    } else if (currentStage === 'gather') {
        MetricsDashboard.gatherMetrics_render(selectedDatasets, costEstimate);
    } else if (currentStage === 'post') {
        MetricsDashboard.postMetrics_render();
    }
}
