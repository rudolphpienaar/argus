/**
 * @file Telemetry Manager
 * Orchestrates the dashboard updates based on the current application stage.
 * Now powered by the LCARS Framework Telemetry Service.
 */

import type { AppState, Dataset, CostEstimate } from '../core/models/types.js';
import * as MetricsDashboard from './metrics.js';
import { telemetryService } from '../lcars-framework/telemetry/service.js';
import { telemetry_setup } from './setup.js';

let currentStage: AppState['currentStage'] = 'login';
let initialized = false;

/**
 * Starts the telemetry loop.
 */
export function telemetry_start(): void {
    if (!initialized) {
        telemetry_setup();
        initialized = true;
    }
    telemetryService.start(800);
}

/**
 * Stops the telemetry loop.
 */
export function telemetry_stop(): void {
    telemetryService.stop();
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