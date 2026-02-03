/**
 * @file Monitor Stage Logic
 *
 * Handles the federated training simulation, progress tracking, and visualization.
 *
 * @module
 */

import { state, globals, store } from '../state/store.js';
import { MOCK_NODES } from '../data/nodes.js';
import { gutter_setStatus, gutter_resetAll } from '../../ui/gutters.js';
import { stage_advanceTo } from '../logic/navigation.js';
import type { TrainingJob, TrustedDomainNode } from '../models/types.js';

// ============================================================================
// Initialization
// ============================================================================

/**
 * Hook called when entering the Monitor stage.
 * Creates a training job if none exists, sets up the loss chart canvas,
 * renders initial node status, and starts the training simulation interval.
 */
export function stage_enter(): void {
    if (!state.trainingJob) {
        store.trainingJob_set({
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
            nodes: JSON.parse(JSON.stringify(MOCK_NODES)) as TrustedDomainNode[],
            lossHistory: []
        });
    }

    const canvas: HTMLCanvasElement | null = document.getElementById('loss-canvas') as HTMLCanvasElement;
    if (canvas) {
        const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
        if (ctx) {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            globals.lossChart = { ctx, data: [] };
        }
    }

    nodeStatus_render();

    if (globals.trainingInterval) clearInterval(globals.trainingInterval);
    globals.trainingInterval = window.setInterval(trainingStep_simulate, 500);
}

/**
 * Hook called when exiting the Monitor stage.
 * No-op for now.
 */
export function stage_exit(): void {
    // Teardown if needed
}

// ============================================================================
// Training Simulation
// ============================================================================

/**
 * Simulates a single training step: advances the epoch, recalculates
 * loss/accuracy/AUC, updates node statuses, and refreshes the UI.
 */
export function trainingStep_simulate(): void {
    if (!state.trainingJob || state.trainingJob.status !== 'running') return;

    // Create a copy of the job and the lossHistory array to avoid direct state mutation
    const job: TrainingJob = { 
        ...state.trainingJob,
        lossHistory: [...state.trainingJob.lossHistory]
    };

    job.currentEpoch += 0.5;
    if (job.currentEpoch > job.totalEpochs) {
        training_complete();
        return;
    }

    const baseLoss: number = 2.5 * Math.exp(-job.currentEpoch / 15);
    job.loss = baseLoss + (Math.random() - 0.5) * 0.1;
    job.lossHistory.push(job.loss);

    job.accuracy = Math.min(98, 50 + (job.currentEpoch / job.totalEpochs) * 48 + (Math.random() - 0.5) * 2);
    job.auc = Math.min(0.99, 0.5 + (job.currentEpoch / job.totalEpochs) * 0.49);

    job.runningCost = (job.currentEpoch / job.totalEpochs) * state.costEstimate.total;

    job.nodes.forEach((node: TrustedDomainNode, i: number): void => {
        if (i === job.nodes.length - 1) {
            node.status = job.currentEpoch % 5 < 1 ? 'active' : 'waiting';
        } else {
            const nodeProgress: number = (job.currentEpoch / job.totalEpochs) * 100;
            node.progress = Math.min(100, nodeProgress + (Math.random() - 0.5) * 10);
            node.samplesProcessed = Math.floor((node.progress / 100) * node.totalSamples);

            if (node.progress >= 100) {
                node.status = 'complete';
            } else if (job.currentEpoch % 5 < 2) {
                node.status = 'active';
            } else {
                node.status = 'waiting';
            }
        }
    });

    store.trainingJob_update(job);

    if (Math.random() > 0.6 && globals.terminal) {
        const telemetryEvents: readonly string[] = [
            `[NET] Syncing gradients with node-${Math.floor(Math.random() * 4) + 1}...`,
            `[SEC] Verifying homomorphic encryption keys...`,
            `[GPU] Tensor core utilization at 98%...`,
            `[FED] Aggregating partial model weights (Round ${Math.floor(job.currentEpoch)})...`,
            `[OPT] Adjusting learning rate: ${(0.001 * Math.random()).toFixed(5)}`,
            `[MEM] VRAM Allocation: ${(Math.random() * 10 + 4).toFixed(1)} GB`,
            `[ERR] Backward pass delta within tolerance.`
        ];
        globals.terminal.println(`<span class="dim">${telemetryEvents[Math.floor(Math.random() * telemetryEvents.length)]}</span>`);
    }

    const gutterIndex: number = Math.floor(job.currentEpoch) % 5 + 1;
    gutter_resetAll();
    gutter_setStatus(4, 'active');
    if (gutterIndex !== 4) {
        gutter_setStatus(gutterIndex, 'active');
    }

    monitorUI_update();
}

// ============================================================================
// UI Updates
// ============================================================================

/**
 * Updates the monitor UI with current training state:
 * progress bar, epoch display, metrics, cost tracker, loss chart, and node status.
 */
function monitorUI_update(): void {
    if (!state.trainingJob) return;
    const job: TrainingJob = state.trainingJob;

    const progressFill: HTMLElement | null = document.getElementById('progress-fill');
    if (progressFill) {
        progressFill.style.width = `${(job.currentEpoch / job.totalEpochs) * 100}%`;
    }

    const currentEpoch: HTMLElement | null = document.getElementById('current-epoch');
    const epochStatus: HTMLElement | null = document.getElementById('epoch-status');
    if (currentEpoch) currentEpoch.textContent = Math.floor(job.currentEpoch).toString();
    if (epochStatus) epochStatus.textContent = job.status === 'running' ? 'Training...' : job.status;

    const metricLoss: HTMLElement | null = document.getElementById('metric-loss');
    const metricAccuracy: HTMLElement | null = document.getElementById('metric-accuracy');
    const metricAuc: HTMLElement | null = document.getElementById('metric-auc');
    if (metricLoss) metricLoss.textContent = job.loss.toFixed(4);
    if (metricAccuracy) metricAccuracy.textContent = `${job.accuracy.toFixed(1)}%`;
    if (metricAuc) metricAuc.textContent = job.auc.toFixed(3);

    const runningCost: HTMLElement | null = document.getElementById('running-cost');
    const costProgress: HTMLElement | null = document.getElementById('cost-progress');
    if (runningCost) runningCost.textContent = `$${job.runningCost.toFixed(2)}`;
    if (costProgress) costProgress.style.width = `${(job.runningCost / job.budgetLimit) * 100}%`;

    lossChart_draw();
    nodeStatus_render();
}

// ============================================================================
// Loss Chart
// ============================================================================

/**
 * Draws the loss chart on the canvas.
 * Renders a grid and the loss history as a line plot.
 */
function lossChart_draw(): void {
    if (!globals.lossChart || !state.trainingJob) return;
    const { ctx } = globals.lossChart;
    const history: number[] = state.trainingJob.lossHistory;

    const canvas: HTMLCanvasElement = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (history.length < 2) return;

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i: number = 0; i < 5; i++) {
        const y: number = (canvas.height / 5) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    ctx.strokeStyle = '#f91';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const maxLoss: number = Math.max(...history, 0.1);
    const xStep: number = canvas.width / Math.max(history.length - 1, 1);

    history.forEach((loss: number, i: number): void => {
        const x: number = i * xStep;
        const y: number = canvas.height - (loss / maxLoss) * canvas.height * 0.9;
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });

    ctx.stroke();
}

// ============================================================================
// Node Status
// ============================================================================

/**
 * Renders the federated node status cards showing per-node
 * progress and sample counts.
 */
function nodeStatus_render(): void {
    if (!state.trainingJob) return;
    const container: HTMLElement | null = document.getElementById('node-status');
    if (!container) return;

    container.innerHTML = state.trainingJob.nodes.map((node: TrustedDomainNode): string => `
        <div class="node-card">
            <div class="name">${node.name}</div>
            <div class="status ${node.status}">${node.status}</div>
            <div style="font-size: .7rem; margin-top: .25rem; color: var(--font-color);">
                ${node.totalSamples > 0 ? `${node.samplesProcessed.toLocaleString()} / ${node.totalSamples.toLocaleString()}` : 'Aggregator'}
            </div>
        </div>
    `).join('');
}

// ============================================================================
// Training Lifecycle
// ============================================================================

/**
 * Completes the training job: marks all nodes as complete,
 * stops the simulation interval, sets gutters to success,
 * and auto-advances to the Post stage.
 */
export function training_complete(): void {
    if (!state.trainingJob) return;

    const nodes: TrustedDomainNode[] = state.trainingJob.nodes.map(
        (n: TrustedDomainNode): TrustedDomainNode => ({ ...n, status: 'complete' as const })
    );
    store.trainingJob_update({ status: 'complete', nodes });

    if (globals.trainingInterval) {
        clearInterval(globals.trainingInterval);
        globals.trainingInterval = null;
    }

    for (let i: number = 1; i <= 5; i++) {
        gutter_setStatus(i, 'success');
    }

    monitorUI_update();

    const postIndicator: HTMLElement | null = document.querySelector(`.stage-indicator[data-stage="post"]`) as HTMLElement;
    if (postIndicator) {
        postIndicator.classList.remove('disabled');
    }

    const epochStatus: HTMLElement | null = document.getElementById('epoch-status');
    if (epochStatus) epochStatus.textContent = 'Complete!';

    setTimeout((): void => stage_advanceTo('post'), 2000);
}

/**
 * Aborts the training job: stops the simulation interval,
 * sets the gutter to error, and resets the cost display.
 */
export function training_abort(): void {
    if (!state.trainingJob) return;

    store.trainingJob_update({ status: 'aborted' });

    if (globals.trainingInterval) {
        clearInterval(globals.trainingInterval);
        globals.trainingInterval = null;
    }

    gutter_setStatus(4, 'error');

    const epochStatus: HTMLElement | null = document.getElementById('epoch-status');
    if (epochStatus) epochStatus.textContent = 'Aborted - No charge';

    const runningCostEl: HTMLElement | null = document.getElementById('running-cost');
    if (runningCostEl) runningCostEl.textContent = '$0.00';
}
