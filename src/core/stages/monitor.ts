/**
 * @file Monitor Stage Logic
 * 
 * Handles the federated training simulation, progress tracking, and visualization.
 * 
 * @module
 */

import { state, globals } from '../state/store.js';
import { MOCK_NODES } from '../data/nodes.js';
import { cascade_update } from '../logic/telemetry.js';
import { gutter_setStatus, gutter_resetAll } from '../../ui/gutters.js';
import { stage_advanceTo } from '../logic/navigation.js';
import type { TrainingJob } from '../models/types.js';

// Re-export specific UI updaters if needed by other modules, 
// but mostly this module manages its own UI.

/**
 * Initializes the monitor stage.
 */
export function monitor_initialize(): void {
    if (!state.trainingJob) {
        // Auto-initialize a job if none exists (e.g. direct navigation)
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
    }

    // Initialize loss chart
    const canvas: HTMLCanvasElement | null = document.getElementById('loss-canvas') as HTMLCanvasElement;
    if (canvas) {
        const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
        if (ctx) {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            globals.lossChart = { ctx, data: [] };
        }
    }

    // Render initial node status
    nodeStatus_render();

    // Start training simulation
    if (globals.trainingInterval) clearInterval(globals.trainingInterval);
    globals.trainingInterval = window.setInterval(trainingStep_simulate, 500);
}

/**
 * Simulates a training step.
 */
export function trainingStep_simulate(): void {
    if (!state.trainingJob || state.trainingJob.status !== 'running') return;

    const job: TrainingJob = state.trainingJob;

    // Simulate progress
    job.currentEpoch += 0.5;
    if (job.currentEpoch > job.totalEpochs) {
        training_complete();
        return;
    }

    // Simulate loss decrease with noise
    const baseLoss: number = 2.5 * Math.exp(-job.currentEpoch / 15);
    job.loss = baseLoss + (Math.random() - 0.5) * 0.1;
    job.lossHistory.push(job.loss);

    // Simulate accuracy increase
    job.accuracy = Math.min(98, 50 + (job.currentEpoch / job.totalEpochs) * 48 + (Math.random() - 0.5) * 2);
    job.auc = Math.min(0.99, 0.5 + (job.currentEpoch / job.totalEpochs) * 0.49);

    // Simulate cost
    job.runningCost = (job.currentEpoch / job.totalEpochs) * state.costEstimate.total;

    // Update node statuses
    job.nodes.forEach((node, i) => {
        if (i === job.nodes.length - 1) {
            // Aggregator
            node.status = job.currentEpoch % 5 < 1 ? 'active' : 'waiting';
        } else {
            // Training nodes
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

    // Hacker Telemetry - Terminal Stream
    if (Math.random() > 0.6 && globals.terminal) {
        const events = [
            `[NET] Syncing gradients with node-${Math.floor(Math.random()*4)+1}...`,
            `[SEC] Verifying homomorphic encryption keys...`,
            `[GPU] Tensor core utilization at 98%...`,
            `[FED] Aggregating partial model weights (Round ${Math.floor(job.currentEpoch)})...`,
            `[OPT] Adjusting learning rate: ${(0.001 * Math.random()).toFixed(5)}`,
            `[MEM] VRAM Allocation: ${(Math.random() * 10 + 4).toFixed(1)} GB`,
            `[ERR] Backward pass delta within tolerance.`
        ];
        globals.terminal.println(`<span class="dim">${events[Math.floor(Math.random() * events.length)]}</span>`);
    }

    // Pulse gutter during training
    const gutterIndex: number = Math.floor(job.currentEpoch) % 5 + 1;
    gutter_resetAll();
    gutter_setStatus(4, 'active');
    if (gutterIndex !== 4) {
        gutter_setStatus(gutterIndex, 'active');
    }

    monitorUI_update();
}

/**
 * Updates the monitor UI with current training state.
 */
function monitorUI_update(): void {
    if (!state.trainingJob) return;
    const job = state.trainingJob;

    // Progress bar
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) {
        progressFill.style.width = `${(job.currentEpoch / job.totalEpochs) * 100}%`;
    }

    // Epoch display
    const currentEpoch = document.getElementById('current-epoch');
    const epochStatus = document.getElementById('epoch-status');
    if (currentEpoch) currentEpoch.textContent = Math.floor(job.currentEpoch).toString();
    if (epochStatus) epochStatus.textContent = job.status === 'running' ? 'Training...' : job.status;

    // Metrics
    const metricLoss = document.getElementById('metric-loss');
    const metricAccuracy = document.getElementById('metric-accuracy');
    const metricAuc = document.getElementById('metric-auc');
    if (metricLoss) metricLoss.textContent = job.loss.toFixed(4);
    if (metricAccuracy) metricAccuracy.textContent = `${job.accuracy.toFixed(1)}%`;
    if (metricAuc) metricAuc.textContent = job.auc.toFixed(3);

    // Cost tracker
    const runningCost = document.getElementById('running-cost');
    const costProgress = document.getElementById('cost-progress');
    if (runningCost) runningCost.textContent = `$${job.runningCost.toFixed(2)}`;
    if (costProgress) costProgress.style.width = `${(job.runningCost / job.budgetLimit) * 100}%`;

    // Update cascade
    cascade_update();

    // Update loss chart
    lossChart_draw();

    // Update node status
    nodeStatus_render();
}

/**
 * Draws the loss chart.
 */
function lossChart_draw(): void {
    if (!globals.lossChart || !state.trainingJob) return;
    const { ctx } = globals.lossChart;
    const history: number[] = state.trainingJob.lossHistory;

    const canvas: HTMLCanvasElement = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (history.length < 2) return;

    // Draw grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        const y: number = (canvas.height / 5) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    // Draw loss line
    ctx.strokeStyle = '#f91';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const maxLoss: number = Math.max(...history, 0.1);
    const xStep: number = canvas.width / Math.max(history.length - 1, 1);

    history.forEach((loss, i) => {
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

/**
 * Renders the node status cards.
 */
function nodeStatus_render(): void {
    if (!state.trainingJob) return;
    const container = document.getElementById('node-status');
    if (!container) return;

    container.innerHTML = state.trainingJob.nodes.map((node) => `
        <div class="node-card">
            <div class="name">${node.name}</div>
            <div class="status ${node.status}">${node.status}</div>
            <div style="font-size: .7rem; margin-top: .25rem; color: var(--font-color);">
                ${node.totalSamples > 0 ? `${node.samplesProcessed.toLocaleString()} / ${node.totalSamples.toLocaleString()}` : 'Aggregator'}
            </div>
        </div>
    `).join('');
}

/**
 * Completes the training job.
 */
export function training_complete(): void {
    if (!state.trainingJob) return;

    state.trainingJob.status = 'complete';
    state.trainingJob.nodes.forEach(n => n.status = 'complete');

    if (globals.trainingInterval) {
        clearInterval(globals.trainingInterval);
        globals.trainingInterval = null;
    }

    // Set all gutters to success
    for (let i = 1; i <= 5; i++) {
        gutter_setStatus(i, 'success');
    }

    monitorUI_update();
    
    // Enable post stage
    const postIndicator = document.querySelector(`.stage-indicator[data-stage="post"]`) as HTMLElement;
    if (postIndicator) {
        postIndicator.classList.remove('disabled');
    }

    // Update epoch status
    const epochStatus = document.getElementById('epoch-status');
    if (epochStatus) epochStatus.textContent = 'Complete!';

    // Auto-advance to post after a moment
    setTimeout(() => stage_advanceTo('post'), 2000);
}

/**
 * Aborts the training job.
 */
export function training_abort(): void {
    if (!state.trainingJob) return;

    state.trainingJob.status = 'aborted';

    if (globals.trainingInterval) {
        clearInterval(globals.trainingInterval);
        globals.trainingInterval = null;
    }

    // Set gutter to error
    gutter_setStatus(4, 'error');

    const epochStatus: HTMLElement | null = document.getElementById('epoch-status');
    if (epochStatus) epochStatus.textContent = 'Aborted - No charge';

    // Reset cost
    const runningCost: HTMLElement | null = document.getElementById('running-cost');
    if (runningCost) runningCost.textContent = '$0.00';
}
