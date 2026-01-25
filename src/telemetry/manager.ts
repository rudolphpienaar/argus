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
export function start(): void {
    if (updateInterval) return;
    updateInterval = window.setInterval(tick, 500);
}

/**
 * Stops the telemetry loop.
 */
export function stop(): void {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    MetricsDashboard.stopTicker();
}

/**
 * Updates the current stage context for the manager.
 * @param stage - The new application stage.
 */
export function setStage(stage: AppState['currentStage']): void {
    currentStage = stage;
    updateViewVisibility();
}

/**
 * Main update loop.
 */
function tick(): void {
    // Only run high-frequency updates (System Telemetry) if the view is visible
    if (['login', 'role-selection', 'process', 'monitor'].includes(currentStage)) {
        const isProcess = currentStage === 'process';
        SystemTelemetry.renderProcessList(isProcess);
        SystemTelemetry.renderNetworkStats();
        SystemTelemetry.renderSystemLogs();
    }
    // Metrics dashboard has its own internal ticker for the "Search" stage managed in metrics.ts
}

/**
 * Toggles the visibility of the dashboard containers based on the stage.
 */
function updateViewVisibility(): void {
    const viewMetrics = document.getElementById('view-metrics');
    const viewTelemetry = document.getElementById('telemetry-dashboard');

    if (['login', 'role-selection', 'process', 'monitor'].includes(currentStage)) {
        // Show Telemetry
        if (viewMetrics) viewMetrics.classList.add('hidden');
        if (viewTelemetry) viewTelemetry.classList.remove('hidden');
    } else {
        // Show Metrics
        if (viewMetrics) viewMetrics.classList.remove('hidden');
        if (viewTelemetry) viewTelemetry.classList.add('hidden');
        
        // Trigger initial render for static/low-freq metric views
        // Note: Search stage has an internal ticker started by renderSearchMetrics
    }
}

/**
 * Forces a refresh of the metrics dashboard (e.g., when selection changes).
 */
export function refreshMetrics(selectedDatasets: Dataset[], costEstimate: CostEstimate): void {
    if (currentStage === 'search') {
        MetricsDashboard.renderSearchMetrics();
    } else if (currentStage === 'gather') {
        MetricsDashboard.renderGatherMetrics(selectedDatasets, costEstimate);
    } else if (currentStage === 'post') {
        MetricsDashboard.renderPostMetrics();
    }
}
