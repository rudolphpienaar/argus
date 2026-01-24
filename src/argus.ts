/**
 * @file ARGUS Main Application
 *
 * Entry point for the ARGUS (ATLAS Resource Graphical User System) prototype.
 * Implements the Developer vertical of the SeaGaP-MP workflow:
 * Search, Gather, Process, Monitor, Post.
 *
 * @module
 */

import type {
    Dataset,
    FileNode,
    TrustedDomainNode,
    TrainingJob,
    CostEstimate,
    AppState
} from './core/models/types.js';

// ============================================================================
// Version Information
// ============================================================================

/**
 * Application version. Keep in sync with package.json version.
 */
const VERSION = '0.1.0';

/**
 * Git commit hash (short). Update on each commit.
 */
const GIT_HASH = '009b82';

// ============================================================================
// Mock Data
// ============================================================================

const MOCK_DATASETS: Dataset[] = [
    {
        id: 'ds-001',
        name: 'NIH ChestX-ray14',
        description: 'Large-scale chest X-ray dataset with 14 disease labels',
        modality: 'xray',
        annotationType: 'classification',
        imageCount: 112120,
        size: '42 GB',
        cost: 45.00,
        provider: 'NIH Clinical Center',
        thumbnail: 'data/chest_xray_001.png'
    },
    {
        id: 'ds-002',
        name: 'COVID-CXR Collection',
        description: 'Curated COVID-19 chest radiographs with severity annotations',
        modality: 'xray',
        annotationType: 'classification',
        imageCount: 5000,
        size: '8 GB',
        cost: 25.00,
        provider: 'BSTI Consortium',
        thumbnail: 'data/chest_xray_002.jpg'
    },
    {
        id: 'ds-003',
        name: 'Pneumonia Detection Set',
        description: 'Pediatric chest X-rays labeled for pneumonia detection',
        modality: 'xray',
        annotationType: 'detection',
        imageCount: 5863,
        size: '2 GB',
        cost: 15.00,
        provider: 'Guangzhou Medical',
        thumbnail: 'data/chest_xray_003.jpg'
    },
    {
        id: 'ds-004',
        name: 'Thoracic Segmentation',
        description: 'Chest X-rays with lung and heart segmentation masks',
        modality: 'xray',
        annotationType: 'segmentation',
        imageCount: 800,
        size: '1.5 GB',
        cost: 35.00,
        provider: 'Montgomery County',
        thumbnail: 'data/chest_xray_004.jpg'
    },
    {
        id: 'ds-005',
        name: 'Multi-Label CXR',
        description: 'Chest radiographs with multi-label disease annotations',
        modality: 'xray',
        annotationType: 'classification',
        imageCount: 25000,
        size: '15 GB',
        cost: 55.00,
        provider: 'CheXpert Stanford',
        thumbnail: 'data/chest_xray_005.jpg'
    },
    {
        id: 'ds-006',
        name: 'Tuberculosis Screening',
        description: 'TB screening dataset from multiple countries',
        modality: 'xray',
        annotationType: 'classification',
        imageCount: 3500,
        size: '4 GB',
        cost: 20.00,
        provider: 'WHO TB Initiative',
        thumbnail: 'data/chest_xray_006.jpg'
    }
];

const MOCK_NODES: TrustedDomainNode[] = [
    { id: 'td-001', name: 'BCH-TD-01', institution: "Boston Children's Hospital", status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 5000 },
    { id: 'td-002', name: 'MGH-TD-01', institution: 'Mass General Hospital', status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 8000 },
    { id: 'td-003', name: 'BIDMC-TD-01', institution: 'Beth Israel Deaconess', status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 6500 },
    { id: 'td-004', name: 'BWH-TD-01', institution: "Brigham and Women's", status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 7200 },
    { id: 'td-005', name: 'MOC-HUB', institution: 'Mass Open Cloud (Aggregator)', status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 0 }
];

// ============================================================================
// Application State
// ============================================================================

const state: AppState = {
    currentStage: 'search',
    selectedDatasets: [],
    virtualFilesystem: null,
    costEstimate: { dataAccess: 0, compute: 0, storage: 0, total: 0 },
    trainingJob: null
};

let trainingInterval: number | null = null;
let lossChart: { ctx: CanvasRenderingContext2D; data: number[] } | null = null;

// ============================================================================
// UI Functions
// ============================================================================

/**
 * Updates the LCARS clock display.
 */
function clock_update(): void {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false });
    const date = now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const dateEl = document.getElementById('lcars-date');
    const timeEl = document.getElementById('lcars-time');

    if (dateEl) dateEl.textContent = date;
    if (timeEl) timeEl.textContent = time;
}

/**
 * Toggles the top frame visibility.
 *
 * @param event - The click event
 */
function ui_toggleTopFrame(event?: Event): void {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }

    const topFrame = document.getElementById('top-frame');
    const rightTopFrame = document.getElementById('right-top-frame');
    const button = document.getElementById('topBtn');
    const buttonText = button?.querySelector('.hop');

    if (topFrame && rightTopFrame && buttonText) {
        const isHidden = topFrame.classList.toggle('hidden');
        rightTopFrame.classList.toggle('hidden');
        buttonText.textContent = isHidden ? 'hide' : 'show';
    }
}

/**
 * Advances to a specific SeaGaP-MP stage.
 *
 * @param stageName - The target stage name
 */
function stage_advanceTo(stageName: AppState['currentStage']): void {
    state.currentStage = stageName;

    // Update stage navigation buttons
    document.querySelectorAll('.stage-nav button').forEach(btn => {
        const btnStage = btn.getAttribute('data-stage');
        btn.classList.toggle('active', btnStage === stageName);
    });

    // Show/hide stage content
    document.querySelectorAll('.stage-content').forEach(content => {
        const contentStage = content.getAttribute('data-stage');
        content.classList.toggle('active', contentStage === stageName);
    });

    // Update sidebar indicator
    const stageIndicator = document.getElementById('stage-indicator');
    if (stageIndicator) {
        stageIndicator.textContent = stageName.toUpperCase();
    }

    // Stage-specific initialization
    if (stageName === 'gather') {
        filesystem_build();
        costs_calculate();
    } else if (stageName === 'monitor') {
        monitor_initialize();
    }
}

/**
 * Enables or disables a stage navigation button.
 *
 * @param stageName - The stage to enable/disable
 * @param enabled - Whether to enable the button
 */
function stageButton_setEnabled(stageName: string, enabled: boolean): void {
    const btn = document.querySelector(`.stage-nav button[data-stage="${stageName}"]`) as HTMLButtonElement;
    if (btn) {
        btn.disabled = !enabled;
    }
}

// ============================================================================
// Search Stage Functions
// ============================================================================

/**
 * Searches the catalog and displays results.
 */
function catalog_search(): void {
    const query = (document.getElementById('search-query') as HTMLInputElement)?.value.toLowerCase() || '';
    const modality = (document.getElementById('search-modality') as HTMLSelectElement)?.value || '';
    const annotation = (document.getElementById('search-annotation') as HTMLSelectElement)?.value || '';

    const filtered = MOCK_DATASETS.filter(ds => {
        const matchesQuery = !query || ds.name.toLowerCase().includes(query) || ds.description.toLowerCase().includes(query);
        const matchesModality = !modality || ds.modality === modality;
        const matchesAnnotation = !annotation || ds.annotationType === annotation;
        return matchesQuery && matchesModality && matchesAnnotation;
    });

    datasetResults_render(filtered);
}

/**
 * Renders dataset search results.
 *
 * @param datasets - The datasets to display
 */
function datasetResults_render(datasets: Dataset[]): void {
    const container = document.getElementById('dataset-results');
    if (!container) return;

    container.innerHTML = datasets.map(ds => `
        <div class="dataset-card ${state.selectedDatasets.some(s => s.id === ds.id) ? 'selected' : ''}"
             data-id="${ds.id}"
             onclick="dataset_toggle('${ds.id}')">
            <img class="thumbnail" src="${ds.thumbnail}" alt="${ds.name}" onerror="this.style.display='none'">
            <h4>${ds.name}</h4>
            <div class="meta">
                <span>${ds.modality.toUpperCase()} · ${ds.annotationType}</span>
                <span>${ds.imageCount.toLocaleString()} images · ${ds.size}</span>
                <span>${ds.provider}</span>
                <span class="cost">$${ds.cost.toFixed(2)}</span>
            </div>
        </div>
    `).join('');
}

/**
 * Toggles dataset selection.
 *
 * @param datasetId - The dataset ID to toggle
 */
function dataset_toggle(datasetId: string): void {
    const dataset = MOCK_DATASETS.find(ds => ds.id === datasetId);
    if (!dataset) return;

    const index = state.selectedDatasets.findIndex(ds => ds.id === datasetId);
    if (index >= 0) {
        state.selectedDatasets.splice(index, 1);
    } else {
        state.selectedDatasets.push(dataset);
    }

    // Update UI
    document.querySelectorAll('.dataset-card').forEach(card => {
        const cardId = card.getAttribute('data-id');
        card.classList.toggle('selected', state.selectedDatasets.some(ds => ds.id === cardId));
    });

    selectionCount_update();
}

/**
 * Updates the selection count display and button state.
 */
function selectionCount_update(): void {
    const count = state.selectedDatasets.length;
    const countEl = document.getElementById('selection-count');
    const btnToGather = document.getElementById('btn-to-gather') as HTMLButtonElement;
    const itemCount = document.getElementById('item-count');

    if (countEl) {
        countEl.textContent = `${count} dataset${count !== 1 ? 's' : ''} selected`;
    }

    if (btnToGather) {
        btnToGather.disabled = count === 0;
    }

    if (itemCount) {
        itemCount.innerHTML = `${count} <span class="hop">items</span>`;
    }

    stageButton_setEnabled('gather', count > 0);
}

// ============================================================================
// Gather Stage Functions
// ============================================================================

/**
 * Builds the virtual filesystem from selected datasets.
 */
function filesystem_build(): void {
    const root: FileNode = {
        name: 'cohort',
        type: 'folder',
        path: '/cohort',
        children: [
            {
                name: 'training',
                type: 'folder',
                path: '/cohort/training',
                children: state.selectedDatasets.map(ds => ({
                    name: ds.name.replace(/\s+/g, '_'),
                    type: 'folder' as const,
                    path: `/cohort/training/${ds.name.replace(/\s+/g, '_')}`,
                    children: [
                        { name: 'images', type: 'folder' as const, path: '', children: [
                            { name: 'img_001.png', type: 'image' as const, path: 'data/chest_xray_001.png' },
                            { name: 'img_002.jpg', type: 'image' as const, path: 'data/chest_xray_002.jpg' },
                            { name: 'img_003.jpg', type: 'image' as const, path: 'data/chest_xray_003.jpg' }
                        ]},
                        { name: 'labels.csv', type: 'file' as const, path: '', size: '1.2 MB' },
                        { name: 'metadata.json', type: 'file' as const, path: '', size: '45 KB' }
                    ]
                }))
            },
            {
                name: 'validation',
                type: 'folder',
                path: '/cohort/validation',
                children: [
                    { name: 'images', type: 'folder' as const, path: '', children: [
                        { name: 'val_001.jpg', type: 'image' as const, path: 'data/chest_xray_004.jpg' },
                        { name: 'val_002.jpg', type: 'image' as const, path: 'data/chest_xray_005.jpg' }
                    ]},
                    { name: 'labels.csv', type: 'file' as const, path: '', size: '256 KB' }
                ]
            }
        ]
    };

    state.virtualFilesystem = root;
    fileTree_render(root);
}

/**
 * Renders the file tree in the UI.
 *
 * @param node - The root node to render
 */
function fileTree_render(node: FileNode): void {
    const container = document.getElementById('file-tree');
    if (!container) return;

    function nodeHtml_build(n: FileNode): string {
        const typeClass = n.type;
        if (n.children && n.children.length > 0) {
            return `
                <li class="${typeClass}">${n.name}
                    <ul>${n.children.map(nodeHtml_build).join('')}</ul>
                </li>
            `;
        }
        return `<li class="${typeClass}" onclick="filePreview_show('${n.path}', '${n.type}')">${n.name}</li>`;
    }

    container.innerHTML = `<ul>${nodeHtml_build(node)}</ul>`;
}

/**
 * Shows a preview of the selected file.
 *
 * @param path - The file path
 * @param type - The file type
 */
function filePreview_show(path: string, type: string): void {
    const preview = document.getElementById('file-preview');
    if (!preview) return;

    if (type === 'image' && path) {
        preview.innerHTML = `<img src="${path}" alt="Preview">`;
    } else if (type === 'file') {
        preview.innerHTML = `<p class="hop">File preview not available</p>`;
    } else {
        preview.innerHTML = `<p class="hop">Select a file to preview</p>`;
    }
}

/**
 * Calculates and displays cost estimates.
 */
function costs_calculate(): void {
    const dataAccess = state.selectedDatasets.reduce((sum, ds) => sum + ds.cost, 0);
    const compute = dataAccess * 2.5; // Mock compute cost
    const storage = dataAccess * 0.3; // Mock storage cost

    state.costEstimate = {
        dataAccess,
        compute,
        storage,
        total: dataAccess + compute + storage
    };

    const costData = document.getElementById('cost-data');
    const costCompute = document.getElementById('cost-compute');
    const costStorage = document.getElementById('cost-storage');
    const costTotal = document.getElementById('cost-total');
    const costIndicator = document.getElementById('cost-indicator');

    if (costData) costData.textContent = `$${dataAccess.toFixed(2)}`;
    if (costCompute) costCompute.textContent = `$${compute.toFixed(2)}`;
    if (costStorage) costStorage.textContent = `$${storage.toFixed(2)}`;
    if (costTotal) costTotal.textContent = `$${state.costEstimate.total.toFixed(2)}`;
    if (costIndicator) costIndicator.textContent = `$${state.costEstimate.total.toFixed(2)}`;

    stageButton_setEnabled('process', true);
}

// ============================================================================
// Process Stage Functions
// ============================================================================

/**
 * Launches federated training.
 */
function training_launch(): void {
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

// ============================================================================
// Monitor Stage Functions
// ============================================================================

/**
 * Initializes the monitor stage.
 */
function monitor_initialize(): void {
    if (!state.trainingJob) return;

    // Initialize loss chart
    const canvas = document.getElementById('loss-canvas') as HTMLCanvasElement;
    if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            lossChart = { ctx, data: [] };
        }
    }

    // Render initial node status
    nodeStatus_render();

    // Start training simulation
    if (trainingInterval) clearInterval(trainingInterval);
    trainingInterval = window.setInterval(trainingStep_simulate, 500);
}

/**
 * Simulates a training step.
 */
function trainingStep_simulate(): void {
    if (!state.trainingJob || state.trainingJob.status !== 'running') return;

    const job = state.trainingJob;

    // Simulate progress
    job.currentEpoch += 0.5;
    if (job.currentEpoch > job.totalEpochs) {
        training_complete();
        return;
    }

    // Simulate loss decrease with noise
    const baseLoss = 2.5 * Math.exp(-job.currentEpoch / 15);
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
            const nodeProgress = (job.currentEpoch / job.totalEpochs) * 100;
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

    // Update loss chart
    lossChart_draw();

    // Update node status
    nodeStatus_render();
}

/**
 * Draws the loss chart.
 */
function lossChart_draw(): void {
    if (!lossChart || !state.trainingJob) return;
    const { ctx, data } = lossChart;
    const history = state.trainingJob.lossHistory;

    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (history.length < 2) return;

    // Draw grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        const y = (canvas.height / 5) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    // Draw loss line
    ctx.strokeStyle = '#f91';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const maxLoss = Math.max(...history, 0.1);
    const xStep = canvas.width / Math.max(history.length - 1, 1);

    history.forEach((loss, i) => {
        const x = i * xStep;
        const y = canvas.height - (loss / maxLoss) * canvas.height * 0.9;
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

    container.innerHTML = state.trainingJob.nodes.map(node => `
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
function training_complete(): void {
    if (!state.trainingJob) return;

    state.trainingJob.status = 'complete';
    state.trainingJob.nodes.forEach(n => n.status = 'complete');

    if (trainingInterval) {
        clearInterval(trainingInterval);
        trainingInterval = null;
    }

    monitorUI_update();
    stageButton_setEnabled('post', true);

    // Update epoch status
    const epochStatus = document.getElementById('epoch-status');
    if (epochStatus) epochStatus.textContent = 'Complete!';

    // Auto-advance to post after a moment
    setTimeout(() => stage_advanceTo('post'), 2000);
}

/**
 * Aborts the training job.
 */
function training_abort(): void {
    if (!state.trainingJob) return;

    state.trainingJob.status = 'aborted';

    if (trainingInterval) {
        clearInterval(trainingInterval);
        trainingInterval = null;
    }

    const epochStatus = document.getElementById('epoch-status');
    if (epochStatus) epochStatus.textContent = 'Aborted - No charge';

    // Reset cost
    const runningCost = document.getElementById('running-cost');
    if (runningCost) runningCost.textContent = '$0.00';
}

// ============================================================================
// Post Stage Functions
// ============================================================================

/**
 * Publishes the trained model to the marketplace.
 */
function model_publish(): void {
    const modelName = (document.getElementById('model-name') as HTMLInputElement)?.value;
    alert(`Model "${modelName}" published to ATLAS Marketplace!\n\nThis is a prototype - in production, this would register the model with full provenance tracking.`);
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initializes the ARGUS application.
 */
/**
 * Displays the application version in the UI.
 */
function version_display(): void {
    const versionEl = document.getElementById('app-version');
    if (versionEl) {
        versionEl.textContent = `v${VERSION}-${GIT_HASH}`;
    }
}

function app_initialize(): void {
    // Display version
    version_display();

    // Start clock
    clock_update();
    setInterval(clock_update, 1000);

    // Initial search
    catalog_search();

    // Expose functions to window for onclick handlers
    (window as unknown as Record<string, unknown>).ui_toggleTopFrame = ui_toggleTopFrame;
    (window as unknown as Record<string, unknown>).stage_advanceTo = stage_advanceTo;
    (window as unknown as Record<string, unknown>).catalog_search = catalog_search;
    (window as unknown as Record<string, unknown>).dataset_toggle = dataset_toggle;
    (window as unknown as Record<string, unknown>).filePreview_show = filePreview_show;
    (window as unknown as Record<string, unknown>).training_launch = training_launch;
    (window as unknown as Record<string, unknown>).training_abort = training_abort;
    (window as unknown as Record<string, unknown>).model_publish = model_publish;
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', app_initialize);
} else {
    app_initialize();
}
