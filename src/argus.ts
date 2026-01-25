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

import * as Telemetry from './telemetry/index.js';
import { VERSION, GIT_HASH } from './generated/version.js';

// ============================================================================ 
// Types
// ============================================================================ 

type Persona = 'developer' | 'annotator' | 'user' | 'provider' | 'scientist' | 'clinician' | 'admin' | 'fda';
type GutterStatus = 'idle' | 'active' | 'success' | 'error';

// ============================================================================ 
// Mock Data
// ============================================================================ 

const MOCK_DATASETS: Dataset[] = [
    {
        id: 'ds-001',
        name: 'BCH Chest X-ray Cohort',
        description: 'Pediatric chest radiographs from Boston Children\'s Hospital',
        modality: 'xray',
        annotationType: 'classification',
        imageCount: 293,
        size: '1.2 GB',
        cost: 45.00,
        provider: 'Boston Children\'s Hospital',
        thumbnail: 'data/BCH/BCH_001.jpg'
    },
    {
        id: 'ds-002',
        name: 'MGH COVID Collection',
        description: 'Adult chest X-rays with COVID-19 annotations',
        modality: 'xray',
        annotationType: 'classification',
        imageCount: 249,
        size: '1.1 GB',
        cost: 35.00,
        provider: 'Mass General Hospital',
        thumbnail: 'data/MGH/MGH_001.jpg'
    },
    {
        id: 'ds-003',
        name: 'BIDMC Pneumonia Set',
        description: 'Emergency department chest films labeled for pneumonia',
        modality: 'xray',
        annotationType: 'detection',
        imageCount: 177,
        size: '0.8 GB',
        cost: 25.00,
        provider: 'Beth Israel Deaconess',
        thumbnail: 'data/BIDMC/BIDMC_001.jpg'
    },
    {
        id: 'ds-004',
        name: 'BWH Thoracic Segments',
        description: 'High-resolution chest X-rays with organ segmentation',
        modality: 'xray',
        annotationType: 'segmentation',
        imageCount: 223,
        size: '1.5 GB',
        cost: 40.00,
        provider: 'Brigham and Women\'s',
        thumbnail: 'data/BWH/BWH_001.jpg'
    },
    {
        id: 'ds-005',
        name: 'Brain MRI Segmentation',
        description: 'Brain Tumor MRI Dataset (Glioma) with generated masks',
        modality: 'mri',
        annotationType: 'segmentation',
        imageCount: 20,
        size: '18 MB',
        cost: 15.00,
        provider: 'Kaggle (Masoud Nickparvar)',
        thumbnail: 'data/KaggleBrain/Training/glioma/Tr-gl_0010.jpg'
    },
    {
        id: 'ds-006',
        name: 'Histology Segmentation',
        description: 'Microscopic white blood cell images with ground truth masks',
        modality: 'pathology',
        annotationType: 'segmentation',
        imageCount: 20,
        size: '15 MB',
        cost: 5.00,
        provider: 'Jiangxi University',
        thumbnail: 'data/WBC/images/WBC_001.bmp'
    }
];

const MOCK_NODES: TrustedDomainNode[] = [
    { id: 'td-001', name: 'BCH-TD-01', institution: "Boston Children's Hospital", status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 293 },
    { id: 'td-002', name: 'MGH-TD-01', institution: 'Mass General Hospital', status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 249 },
    { id: 'td-003', name: 'BIDMC-TD-01', institution: 'Beth Israel Deaconess', status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 177 },
    { id: 'td-004', name: 'BWH-TD-01', institution: "Brigham and Women's", status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 223 },
    { id: 'td-005', name: 'MOC-HUB', institution: 'Mass Open Cloud (Aggregator)', status: 'initializing', progress: 0, samplesProcessed: 0, totalSamples: 0 }
];

// ============================================================================ 
// Application State
// ============================================================================ 

const state: AppState & { currentPersona: Persona } = {
    currentPersona: 'developer',
    currentStage: 'login',
    selectedDatasets: [],
    virtualFilesystem: null,
    costEstimate: { dataAccess: 0, compute: 0, storage: 0, total: 0 },
    trainingJob: null
};

let trainingInterval: number | null = null;
let lossChart: {ctx: CanvasRenderingContext2D; data: number[]} | null = null;

// ============================================================================ 
// Clock & Version Functions
// ============================================================================ 

/**
 * Updates the LCARS clock display.
 */
function clock_update(): void {
    const now: Date = new Date();
    const time: string = now.toLocaleTimeString('en-US', { hour12: false });
    const date: string = now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    const dateEl: HTMLElement | null = document.getElementById('lcars-date');
    const timeEl: HTMLElement | null = document.getElementById('lcars-time');

    if (dateEl) dateEl.textContent = date;
    if (timeEl) timeEl.textContent = time;
}

/**
 * Displays the application version in the UI.
 */
function version_display(): void {
    const versionEl: HTMLElement | null = document.getElementById('app-version');
    if (versionEl) {
        versionEl.textContent = `v${VERSION}-${GIT_HASH}`;
    }
}

// ============================================================================ 
// UI Functions
// ============================================================================ 

/**
 * Toggles the visibility of the top frame.
 *
 * @param event - The click event
 */
function ui_toggleTopFrame(event: Event): void {
    event.preventDefault();
    const topFrame: HTMLElement | null = document.getElementById('top-frame');
    const topBtn: HTMLElement | null = document.getElementById('topBtn');

    if (topFrame && topBtn) {
        topFrame.classList.toggle('collapsed');
        const isCollapsed: boolean = topFrame.classList.contains('collapsed');
        const spanEl: Element | null = topBtn.querySelector('span.hop');
        if (spanEl) {
            spanEl.textContent = isCollapsed ? 'show' : 'hide';
        }
    }
}

/**
 * Updates the SeaGaP progress tracker in the top right panel.
 *
 * @param currentStage - The current stage name
 */
function ui_updateTracker(currentStage: AppState['currentStage']): void {
    // Only update tracker for SeaGaP stages
    const seaGapStages: AppState['currentStage'][] = ['search', 'gather', 'process', 'monitor', 'post'];
    if (!seaGapStages.includes(currentStage)) return;

    const currentIndex: number = seaGapStages.indexOf(currentStage);

    seaGapStages.forEach((stage: AppState['currentStage'], index: number) => {
        const segment: HTMLElement | null = document.getElementById(`trk-${stage}`);
        if (!segment) return;

        // Reset classes
        segment.classList.remove('active', 'visited');

        if (index === currentIndex) {
            segment.classList.add('active');
        } else if (index < currentIndex) {
            segment.classList.add('visited');
        }
        // Future stages remain with default opacity/pointer-events (handled by CSS)
    });
}

// ============================================================================ 
// Persona Functions
// ============================================================================ 

/**
 * Switches to a new persona.
 *
 * @param persona - The persona to switch to
 */
function persona_switch(persona: Persona): void {
    state.currentPersona = persona;

    // Update left frame persona display
    const personaEl: HTMLElement | null = document.getElementById('current-persona');
    if (personaEl) {
        personaEl.textContent = persona.toUpperCase();
    }

    // Flash gutter to indicate change
    gutter_setStatus(1, 'active');
    setTimeout(() => gutter_setStatus(1, 'success'), 300);
    setTimeout(() => gutter_setStatus(1, 'idle'), 800);
}

// ============================================================================ 
// Stage Navigation Functions
// ============================================================================ 

/**
 * Advances to a specific SeaGaP-MP stage.
 *
 * @param stageName - The target stage name
 */
function stage_advanceTo(stageName: AppState['currentStage']): void {
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

    // Update Tracker
    ui_updateTracker(stageName);

    // Update Telemetry Context
    Telemetry.Manager.stage_set(stageName);
    
    // Force a metric refresh if we are entering a relevant stage
    Telemetry.Manager.metrics_refresh(state.selectedDatasets, state.costEstimate);

    // Stage-specific initialization
    if (stageName === 'gather') {
        filesystem_build();
        costs_calculate();
        gutter_setStatus(2, 'active');
    } else if (stageName === 'process') {
        gutter_setStatus(3, 'active');
    } else if (stageName === 'monitor') {
        monitor_initialize();
        gutter_setStatus(4, 'active');
    } else if (stageName === 'post') {
        gutter_setStatus(5, 'active');
    } else {
        gutter_setStatus(1, 'active');
    }
}

/**
 * Enables or disables a stage indicator.
 *
 * @param stageName - The stage to enable/disable
 * @param enabled - Whether to enable the indicator
 */
function stageButton_setEnabled(stageName: string, enabled: boolean): void {
    const indicator: HTMLElement | null = document.querySelector(`.stage-indicator[data-stage="${stageName}"]`) as HTMLElement;
    if (indicator) {
        indicator.classList.toggle('disabled', !enabled);
    }
}

/**
 * Initializes stage indicator click handlers.
 */
function stageIndicators_initialize(): void {
    document.querySelectorAll('.stage-indicator').forEach((indicator: Element) => {
        indicator.addEventListener('click', () => {
            const stage: AppState['currentStage'] | null = indicator.getAttribute('data-stage') as AppState['currentStage'];
            if (stage && !indicator.classList.contains('disabled')) {
                stage_advanceTo(stage);
            }
        });
    });
}

// ============================================================================ 
// Gutter Functions
// ============================================================================ 

/**
 * Sets the status of a gutter section.
 *
 * @param section - The gutter section number (1-5)
 * @param status - The status to set
 */
function gutter_setStatus(section: number, status: GutterStatus): void {
    const gutter: HTMLElement | null = document.getElementById(`gutter-${section}`);
    if (gutter) {
        gutter.setAttribute('data-status', status);
    }
}

/**
 * Resets all gutter sections to idle.
 */
function gutter_resetAll(): void {
    for (let i: number = 1; i <= 5; i++) {
        gutter_setStatus(i, 'idle');
    }
}

// ============================================================================ 
// Login Stage Functions
// ============================================================================ 

/**
 * Authenticates the user (mock).
 */
function user_authenticate(): void {
    const user: string = (document.getElementById('login-user') as HTMLInputElement)?.value ?? '';
    const pass: string = (document.getElementById('login-pass') as HTMLInputElement)?.value ?? '';

    // For prototype, accept any non-empty input or just let them through
    // Simple "animation" of success
    const btn: HTMLButtonElement | null = document.querySelector('.login-form button') as HTMLButtonElement;
    if (btn) {
        btn.textContent = 'ACCESS GRANTED';
        btn.classList.add('pulse');
    }

    setTimeout(() => {
        state.currentStage = 'role-selection';
        stage_advanceTo('role-selection');
        
        // Reset button
        if (btn) {
            btn.textContent = 'AUTHENTICATE';
            btn.classList.remove('pulse');
        }
    }, 1000);
}

/**
 * Logs the user out and returns to the login screen.
 */
function user_logout(): void {
    // Reset state
    state.currentStage = 'login';
    state.selectedDatasets = [];
    state.virtualFilesystem = null;
    state.trainingJob = null;
    state.costEstimate = { dataAccess: 0, compute: 0, storage: 0, total: 0 };
    
    // Clear intervals
    if (trainingInterval) {
        clearInterval(trainingInterval);
        trainingInterval = null;
    }

    // Stop Telemetry
    Telemetry.Manager.telemetry_stop();
    Telemetry.Manager.stage_set('login');
    Telemetry.Manager.telemetry_start();

    // Update UI
    stage_advanceTo('login');
    
    // Reset login form
    const userIn: HTMLInputElement | null = document.getElementById('login-user') as HTMLInputElement;
    const passIn: HTMLInputElement | null = document.getElementById('login-pass') as HTMLInputElement;
    const btn: HTMLButtonElement | null = document.querySelector('.login-form button') as HTMLButtonElement;
    
    if (userIn) userIn.value = '';
    if (passIn) passIn.value = '';
    if (btn) btn.textContent = 'INITIATE SESSION';

    // Reset tracker visualization (though it's hidden in login)
    // No explicit call needed as stage_advanceTo('login') will handle visibility
}

/**
 * Selects the user persona/role and initializes the workflow.
 * 
 * @param persona - The selected persona
 */
function role_select(persona: Persona): void {
    // Set persona
    persona_switch(persona);
    
    // Advance to Search
    state.currentStage = 'search';
    stage_advanceTo('search');
}

// ============================================================================ 
// Search Stage Functions
// ============================================================================ 

/**
 * Searches the catalog and displays results.
 */
function catalog_search(): void {
    const query: string = (document.getElementById('search-query') as HTMLInputElement)?.value.toLowerCase() || '';
    const modality: string = (document.getElementById('search-modality') as HTMLSelectElement)?.value || '';
    const annotation: string = (document.getElementById('search-annotation') as HTMLSelectElement)?.value || '';

    const filtered: Dataset[] = MOCK_DATASETS.filter((ds: Dataset) => {
        const matchesQuery: boolean = !query || ds.name.toLowerCase().includes(query) || ds.description.toLowerCase().includes(query);
        const matchesModality: boolean = !modality || ds.modality === modality;
        const matchesAnnotation: boolean = !annotation || ds.annotationType === annotation;
        return matchesQuery && matchesModality && matchesAnnotation;
    });

    datasetResults_render(filtered);

    // Flash gutter on search
    gutter_setStatus(1, 'active');
    setTimeout(() => gutter_setStatus(1, 'success'), 200);
    setTimeout(() => gutter_setStatus(1, 'idle'), 600);
}

/**
 * Renders dataset search results.
 *
 * @param datasets - The datasets to display
 */
function datasetResults_render(datasets: Dataset[]): void {
    const container: HTMLElement | null = document.getElementById('dataset-results');
    if (!container) return;

    container.innerHTML = datasets.map((ds: Dataset) => `
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
    const dataset: Dataset | undefined = MOCK_DATASETS.find((ds: Dataset) => ds.id === datasetId);
    if (!dataset) return;

    const index: number = state.selectedDatasets.findIndex((ds: Dataset) => ds.id === datasetId);
    if (index >= 0) {
        state.selectedDatasets.splice(index, 1);
    } else {
        state.selectedDatasets.push(dataset);
    }

    // Update UI
    document.querySelectorAll('.dataset-card').forEach((card: Element) => {
        const cardId: string | null = card.getAttribute('data-id');
        card.classList.toggle('selected', state.selectedDatasets.some(ds => ds.id === cardId));
    });

    selectionCount_update();
    Telemetry.Manager.metrics_refresh(state.selectedDatasets, state.costEstimate);
}

/**
 * Updates the selection count display and button state.
 */
function selectionCount_update(): void {
    const count: number = state.selectedDatasets.length;
    const countEl: HTMLElement | null = document.getElementById('selection-count');
    const btnToGather: HTMLButtonElement | null = document.getElementById('btn-to-gather') as HTMLButtonElement;

    if (countEl) {
        countEl.textContent = `${count} dataset${count !== 1 ? 's' : ''} selected`;
    }

    if (btnToGather) {
        btnToGather.disabled = count === 0;
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
                children: state.selectedDatasets.map((ds: Dataset) => {
                    // Extract provider code from thumbnail path
                    const parts: string[] = ds.thumbnail.split('/');
                    const providerCode: string = parts.length > 2 ? parts[1] : 'UNK';
                    
                    // Generate image nodes based on count
                    const imageNodes: FileNode[] = [];
                    for (let i: number = 1; i <= ds.imageCount; i++) {
                        // Special handling for exemplars
                        if (providerCode === 'WBC') {
                            const fileName: string = `WBC_${String(i).padStart(3, '0')}.bmp`;
                            imageNodes.push({
                                name: fileName,
                                type: 'image',
                                path: `data/WBC/images/${fileName}`
                            });
                        } else if (providerCode === 'KaggleBrain') {
                            // Map index to real filenames (0010 to 0029)
                            const num: number = 10 + (i - 1);
                            const fileName: string = `Tr-gl_${String(num).padStart(4, '0')}.jpg`;
                            imageNodes.push({
                                name: fileName,
                                type: 'image',
                                path: `data/KaggleBrain/Training/glioma/${fileName}`
                            });
                        } else {
                            const fileName: string = `${providerCode}_${String(i).padStart(3, '0')}.jpg`;
                            imageNodes.push({
                                name: fileName,
                                type: 'image',
                                path: `data/${providerCode}/${fileName}`
                            });
                        }
                    }

                    // Build children based on annotation type
                    const children: FileNode[] = [
                        {
                            name: 'images',
                            type: 'folder' as const,
                            path: '',
                            children: imageNodes
                        }
                    ];

                    // Add auxiliary files based on type
                    if (ds.annotationType === 'segmentation') {
                        // Add masks folder
                        const maskNodes: FileNode[] = [];
                        for (let i: number = 1; i <= ds.imageCount; i++) {
                            if (providerCode === 'WBC') {
                                const maskName: string = `WBC_${String(i).padStart(3, '0')}_mask.png`;
                                maskNodes.push({
                                    name: maskName,
                                    type: 'image',
                                    path: `data/WBC/masks/${maskName}`
                                });
                            } else if (providerCode === 'KaggleBrain') {
                                const num: number = 10 + (i - 1);
                                const maskName: string = `Tr-gl_${String(num).padStart(4, '0')}_mask.png`;
                                maskNodes.push({
                                    name: maskName,
                                    type: 'image',
                                    path: `data/KaggleBrain/masks/${maskName}`
                                });
                            } else {
                                const maskName: string = `${providerCode}_${String(i).padStart(3, '0')}_mask.png`;
                                maskNodes.push({
                                    name: maskName,
                                    type: 'image',
                                    path: `data/${providerCode}/masks/${maskName}`
                                });
                            }
                        }
                        children.push({
                            name: 'masks',
                            type: 'folder' as const,
                            path: '',
                            children: maskNodes
                        });
                    } else if (ds.annotationType === 'detection') {
                        // Add annotations.json
                        children.push({
                            name: 'annotations.json',
                            type: 'file' as const,
                            path: '',
                            size: `${(ds.imageCount * 0.15).toFixed(1)} KB`
                        });
                    } else {
                        // Default classification: labels.csv
                        children.push({
                            name: 'labels.csv',
                            type: 'file' as const,
                            path: '',
                            size: `${(ds.imageCount * 0.05).toFixed(1)} KB`
                        });
                    }
                    
                    // Always add metadata
                    children.push({ name: 'metadata.json', type: 'file' as const, path: '', size: '4 KB' });

                    return {
                        name: ds.name.replace(/\s+/g, '_'),
                        type: 'folder' as const,
                        path: `/cohort/training/${ds.name.replace(/\s+/g, '_')}`,
                        children: children
                    };
                })
            },
            {
                name: 'validation',
                type: 'folder',
                path: '/cohort/validation',
                children: [
                    { name: 'images', type: 'folder' as const, path: '', children: [
                        { name: 'val_001.jpg', type: 'image' as const, path: 'data/NIH/NIH_001.jpg' },
                        { name: 'val_002.jpg', type: 'image' as const, path: 'data/NIH/NIH_002.jpg' }
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
    const container: HTMLElement | null = document.getElementById('file-tree');
    if (!container) return;

    function nodeHtml_build(n: FileNode): string {
        const typeClass: string = n.type;
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
    const preview: HTMLElement | null = document.getElementById('file-preview');
    if (!preview) return;

    if (type === 'image' && path) {
        preview.innerHTML = `<img src="${path}" alt="Preview">`;
    } else if (type === 'file') {
        preview.innerHTML = `<p class="dim">File preview not available</p>`;
    } else {
        preview.innerHTML = `<p class="dim">Select a file to preview</p>`;
    }
}

/**
 * Calculates and displays cost estimates.
 */
function costs_calculate(): void {
    const dataAccess: number = state.selectedDatasets.reduce((sum: number, ds: Dataset) => sum + ds.cost, 0);
    const compute: number = dataAccess * 2.5; // Mock compute cost
    const storage: number = dataAccess * 0.3; // Mock storage cost

    state.costEstimate = {
        dataAccess,
        compute,
        storage,
        total: dataAccess + compute + storage
    };

    const costData: HTMLElement | null = document.getElementById('cost-data');
    const costCompute: HTMLElement | null = document.getElementById('cost-compute');
    const costStorage: HTMLElement | null = document.getElementById('cost-storage');
    const costTotal: HTMLElement | null = document.getElementById('cost-total');

    if (costData) costData.textContent = `$${dataAccess.toFixed(2)}`;
    if (costCompute) costCompute.textContent = `$${compute.toFixed(2)}`;
    if (costStorage) costStorage.textContent = `$${storage.toFixed(2)}`;
    if (costTotal) costTotal.textContent = `$${state.costEstimate.total.toFixed(2)}`;

    Telemetry.Manager.metrics_refresh(state.selectedDatasets, state.costEstimate);
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
    const canvas: HTMLCanvasElement | null = document.getElementById('loss-canvas') as HTMLCanvasElement;
    if (canvas) {
        const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
        if (ctx) {
            canvas.width = canvas.offsetWidth;
            canvas.height = canvas.offsetHeight;
            lossChart = {ctx, data: []};
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
    job.nodes.forEach((node: TrustedDomainNode, i: number) => {
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
    const job: TrainingJob = state.trainingJob;

    // Progress bar
    const progressFill: HTMLElement | null = document.getElementById('progress-fill');
    if (progressFill) {
        progressFill.style.width = `${(job.currentEpoch / job.totalEpochs) * 100}%`;
    }

    // Epoch display
    const currentEpoch: HTMLElement | null = document.getElementById('current-epoch');
    const epochStatus: HTMLElement | null = document.getElementById('epoch-status');
    if (currentEpoch) currentEpoch.textContent = Math.floor(job.currentEpoch).toString();
    if (epochStatus) epochStatus.textContent = job.status === 'running' ? 'Training...' : job.status;

    // Metrics
    const metricLoss: HTMLElement | null = document.getElementById('metric-loss');
    const metricAccuracy: HTMLElement | null = document.getElementById('metric-accuracy');
    const metricAuc: HTMLElement | null = document.getElementById('metric-auc');
    if (metricLoss) metricLoss.textContent = job.loss.toFixed(4);
    if (metricAccuracy) metricAccuracy.textContent = `${job.accuracy.toFixed(1)}%`;
    if (metricAuc) metricAuc.textContent = job.auc.toFixed(3);

    // Cost tracker
    const runningCost: HTMLElement | null = document.getElementById('running-cost');
    const costProgress: HTMLElement | null = document.getElementById('cost-progress');
    if (runningCost) runningCost.textContent = `$${job.runningCost.toFixed(2)}`;
    if (costProgress) costProgress.style.width = `${(job.runningCost / job.budgetLimit) * 100}%`;

    // Update Telemetry
    Telemetry.Manager.metrics_refresh(state.selectedDatasets, state.costEstimate);

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
    const ctx: CanvasRenderingContext2D = lossChart.ctx;
    const history: number[] = state.trainingJob.lossHistory;

    const canvas: HTMLCanvasElement = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (history.length < 2) return;

    // Draw grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i: number = 0; i < 5; i++) {
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

    history.forEach((loss: number, i: number) => {
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
    const container: HTMLElement | null = document.getElementById('node-status');
    if (!container) return;

    container.innerHTML = state.trainingJob.nodes.map((node: TrustedDomainNode) => `
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
    state.trainingJob.nodes.forEach((n: TrustedDomainNode) => n.status = 'complete');

    if (trainingInterval) {
        clearInterval(trainingInterval);
        trainingInterval = null;
    }

    // Set all gutters to success
    for (let i: number = 1; i <= 5; i++) {
        gutter_setStatus(i, 'success');
    }

    monitorUI_update();
    stageButton_setEnabled('post', true);

    // Update epoch status
    const epochStatus: HTMLElement | null = document.getElementById('epoch-status');
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

    // Set gutter to error
    gutter_setStatus(4, 'error');

    const epochStatus: HTMLElement | null = document.getElementById('epoch-status');
    if (epochStatus) epochStatus.textContent = 'Aborted - No charge';

    // Reset cost
    const runningCost: HTMLElement | null = document.getElementById('running-cost');
    if (runningCost) runningCost.textContent = '$0.00';
}

// ============================================================================ 
// Post Stage Functions
// ============================================================================ 

/**
 * Publishes the trained model to the marketplace.
 */
function model_publish(): void {
    const modelName: string | undefined = (document.getElementById('model-name') as HTMLInputElement)?.value;
    alert(`Model "${modelName}" published to ATLAS Marketplace!\n\nThis is a prototype - in production, this would register the model with full provenance tracking.`);
}

// ============================================================================ 
// Initialization
// ============================================================================ 

/**
 * Initializes the ARGUS application.
 */
function app_initialize(): void {
    // Display version
    version_display();

    // Start clock
    clock_update();
    setInterval(clock_update, 1000);

    // Initialize stage indicators
    stageIndicators_initialize();

    // Initial search
    catalog_search();
    selectionCount_update();

    // Initialize Telemetry
    Telemetry.Manager.telemetry_start();

    // Set initial gutter state
    gutter_setStatus(1, 'active');

    // Handle initial login state
    stage_advanceTo(state.currentStage);

    // Expose functions to window for onclick handlers
    (window as unknown as Record<string, unknown>).stage_advanceTo = stage_advanceTo;
    (window as unknown as Record<string, unknown>).catalog_search = catalog_search;
    (window as unknown as Record<string, unknown>).dataset_toggle = dataset_toggle;
    (window as unknown as Record<string, unknown>).filePreview_show = filePreview_show;
    (window as unknown as Record<string, unknown>).training_launch = training_launch;
    (window as unknown as Record<string, unknown>).training_abort = training_abort;
    (window as unknown as Record<string, unknown>).model_publish = model_publish;
    (window as unknown as Record<string, unknown>).persona_switch = persona_switch;
    (window as unknown as Record<string, unknown>).ui_toggleTopFrame = ui_toggleTopFrame;
    (window as unknown as Record<string, unknown>).user_authenticate = user_authenticate;
    (window as unknown as Record<string, unknown>).user_logout = user_logout;
    (window as unknown as Record<string, unknown>).role_select = role_select;
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', app_initialize);
} else {
    app_initialize();
}
