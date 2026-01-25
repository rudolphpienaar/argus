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

import { costEstimate_calculate } from './core/logic/costs.js';
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
let lossChart: { ctx: CanvasRenderingContext2D; data: number[] } | null = null;

/** Tracks which SeaGaP stages have been visited for back-navigation */
const visitedStages: Set<string> = new Set();

/** Ordered list of SeaGaP stages for navigation logic */
const STAGE_ORDER: readonly string[] = ['search', 'gather', 'process', 'monitor', 'post'] as const;

// ============================================================================
// SeaGaP Station Functions
// ============================================================================

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

    // Start global telemetry ticker
    stationTelemetry_start();
}

/**
 * Handles click on a station for back-navigation.
 *
 * @param stageName - The stage to navigate to
 */
function station_click(stageName: string): void {
    // Only allow navigation to visited stages (back-navigation)
    if (!visitedStages.has(stageName)) return;

    // Navigate to the clicked stage
    stage_advanceTo(stageName as AppState['currentStage']);
}

/**
 * Advances to the next stage in the SeaGaP workflow.
 */
function stage_next(): void {
    const currentIndex: number = STAGE_ORDER.indexOf(state.currentStage);
    if (currentIndex === -1 || currentIndex >= STAGE_ORDER.length - 1) return;

    const nextStage: string = STAGE_ORDER[currentIndex + 1];
    stage_advanceTo(nextStage as AppState['currentStage']);
}

/** Telemetry ticker state */
let telemetryTickerInterval: number | null = null;
let telemetryTickCount: number = 0;

/**
 * Initializes and starts the global telemetry ticker for SeaGaP stations.
 */
function stationTelemetry_start(): void {
    if (telemetryTickerInterval) return;

    telemetryTickerInterval = window.setInterval(() => {
        telemetryTickCount++;
        STAGE_ORDER.forEach((stage: string) => {
            stationTelemetry_tick(stage as AppState['currentStage']);
        });
    }, 800);
}

/**
 * Generates dynamic telemetry content for a station.
 *
 * @param stageName - The stage to generate content for
 */
function stationTelemetry_tick(stageName: AppState['currentStage']): void {
    const stationEl = document.getElementById(`station-${stageName}`);
    if (!stationEl || (!stationEl.classList.contains('active') && !stationEl.classList.contains('visited'))) {
        return;
    }

    const teleEl = document.getElementById(`tele-${stageName}`);
    if (!teleEl) return;

    const contentEl = teleEl.querySelector('.tele-content');
    if (!contentEl) return;

    const isActive = stationEl.classList.contains('active');
    const t = telemetryTickCount + (STAGE_ORDER.indexOf(stageName) * 10); // Offset for variety
    const timeStr = String(t % 10000).padStart(4, '0');

    // Dynamic content generators for each stage
    const generators: Record<string, () => string> = {
        search: () => {
            if (!isActive) return `<span class="dim">[${timeStr}]</span> <span class="highlight">SCAN COMPLETE</span><br>HITS: 42<br>STATUS: IDLE`;
            const queries: string[] = ['chest xray', 'pneumonia', 'covid-19', 'thoracic', 'lung nodule'];
            const query: string = queries[t % queries.length];
            return `<span class="dim">[${timeStr}]</span> SCAN: <span class="highlight">XRAY</span><br>` +
                   `QUERY: "<span class="warn">${query}</span>"<br>` +
                   `HITS: <span class="highlight">${Math.floor(Math.random() * 50 + 10)}</span><br>` +
                   `LATENCY: ${Math.floor(Math.random() * 50 + 5)}ms`;
        },
        gather: () => {
            if (!isActive) return `<span class="dim">[${timeStr}]</span> <span class="highlight">GATHERED</span><br>IMG: ${state.selectedDatasets.reduce((sum, d) => sum + d.imageCount, 0)}<br>STATUS: SYNCED`;
            const ops: string[] = ['INDEXING', 'HASHING', 'VALIDATING', 'CACHING', 'SYNCING'];
            return `<span class="dim">[${timeStr}]</span> <span class="warn">${ops[t % ops.length]}</span><br>` +
                   `DATASETS: <span class="highlight">${state.selectedDatasets.length}</span><br>` +
                   `IMAGES: ${state.selectedDatasets.reduce((sum, d) => sum + d.imageCount, 0).toLocaleString()}<br>` +
                   `COST: <span class="highlight">$${state.costEstimate.total.toFixed(2)}</span>`;
        },
        process: () => {
            if (!isActive) return `<span class="dim">[${timeStr}]</span> <span class="highlight">COMPILED</span><br>MODEL: ResNet50<br>READY: YES`;
            const tasks: string[] = ['COMPILING', 'LINKING', 'VALIDATING', 'OPTIMIZING', 'STAGING'];
            return `<span class="dim">[${timeStr}]</span> <span class="warn">${tasks[t % tasks.length]}</span><br>` +
                   `MODEL: ResNet50<br>` +
                   `PARAMS: <span class="highlight">25.6M</span><br>` +
                   `GPU MEM: ${(Math.random() * 4 + 8).toFixed(1)} GB`;
        },
        monitor: () => {
            const epoch = state.trainingJob?.currentEpoch ?? 0;
            const loss = state.trainingJob?.loss?.toFixed(4) ?? (2.5 - (t % 100) * 0.02).toFixed(4);
            if (!isActive) return `<span class="dim">[${timeStr}]</span> <span class="highlight">FINISHED</span><br>EPOCH: 50/50<br>LOSS: 0.0231`;
            return `<span class="dim">[${timeStr}]</span> <span class="warn">TRAINING</span><br>` +
                   `EPOCH: <span class="highlight">${Math.floor(epoch)}/50</span><br>` +
                   `LOSS: <span class="warn">${loss}</span><br>` +
                   `THROUGHPUT: ${Math.floor(Math.random() * 100 + 150)} img/s`;
        },
        post: () => {
            if (!isActive) return `<span class="dim">[${timeStr}]</span> <span class="highlight">PUBLISHED</span><br>VER: 1.0.0`;
            const actions: string[] = ['CHECKSUMMING', 'PACKAGING', 'SIGNING', 'REGISTERING', 'PUBLISHING'];
            return `<span class="dim">[${timeStr}]</span> <span class="warn">${actions[t % actions.length]}</span><br>` +
                   `MODEL: ChestXRay-v1<br>` +
                   `SIZE: <span class="highlight">98.2 MB</span><br>` +
                   `ACC: 94.2%  AUC: 0.967`;
        }
    };

    const generator = generators[stageName];
    contentEl.innerHTML = generator ? generator() : 'Initializing...';
}


// ============================================================================
// Clock & Version Functions
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
 * Displays the application version in the UI.
 */
function version_display(): void {
    const versionEl = document.getElementById('app-version');
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
    const topFrame = document.getElementById('top-frame');
    const topBtn = document.getElementById('topBtn');

    if (topFrame && topBtn) {
        topFrame.classList.toggle('collapsed');
        const isCollapsed = topFrame.classList.contains('collapsed');
        const spanEl = topBtn.querySelector('span.hop');
        if (spanEl) {
            spanEl.textContent = isCollapsed ? 'show' : 'hide';
        }
    }
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

    // Update persona buttons
    document.querySelectorAll('.persona-btn').forEach(btn => {
        const btnPersona = btn.getAttribute('data-persona');
        btn.classList.toggle('active', btnPersona === persona);
    });

    // Update left frame persona display
    const personaEl = document.getElementById('current-persona');
    if (personaEl) {
        personaEl.textContent = persona.toUpperCase();
    }

    // Flash gutter to indicate change
    gutter_setStatus(1, 'active');
    setTimeout(() => gutter_setStatus(1, 'success'), 300);
    setTimeout(() => gutter_setStatus(1, 'idle'), 800);
}

/**
 * Initializes persona button click handlers.
 */
function personaButtons_initialize(): void {
    document.querySelectorAll('.persona-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const persona = btn.getAttribute('data-persona') as Persona;
            if (persona) {
                persona_switch(persona);
            }
        });
    });
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

    // Stage-specific initialization
    if (stageName === 'gather') {
        filesystem_build();
        costs_calculate();
        gutter_setStatus(2, 'active');
    } else if (stageName === 'process') {
        gutter_setStatus(3, 'active');
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
 * Enables or disables a stage indicator.
 *
 * @param stageName - The stage to enable/disable
 * @param enabled - Whether to enable the indicator
 */
function stageButton_setEnabled(stageName: string, enabled: boolean): void {
    const indicator = document.querySelector(`.stage-indicator[data-stage="${stageName}"]`) as HTMLElement;
    if (indicator) {
        indicator.classList.toggle('disabled', !enabled);
    }
}

/**
 * Initializes stage indicator click handlers.
 */
function stageIndicators_initialize(): void {
    document.querySelectorAll('.stage-indicator').forEach(indicator => {
        indicator.addEventListener('click', () => {
            const stage = indicator.getAttribute('data-stage') as AppState['currentStage'];
            if (stage && !indicator.classList.contains('disabled')) {
                stage_advanceTo(stage);
            }
        });
    });
}

// ============================================================================
// Data Cascade Functions
// ============================================================================

/**
 * Updates the data cascade display with current metrics or system telemetry.
 */
function cascade_update(): void {
    const datasetsEl: HTMLElement | null = document.getElementById('cascade-datasets');
    const imagesEl: HTMLElement | null = document.getElementById('cascade-images');
    const costEl: HTMLElement | null = document.getElementById('cascade-cost');
    const statusEl: HTMLElement | null = document.getElementById('cascade-status');

    const label1: HTMLElement | null = document.getElementById('cascade-label-1');
    const label2: HTMLElement | null = document.getElementById('cascade-label-2');
    const label3: HTMLElement | null = document.getElementById('cascade-label-3');
    const label4: HTMLElement | null = document.getElementById('cascade-label-4');
    const label5: HTMLElement | null = document.getElementById('cascade-label-5');
    const label6: HTMLElement | null = document.getElementById('cascade-label-6');

    if (state.currentStage === 'login' || state.currentStage === 'role-selection') {
        // Telemetry Mode
        if (label1) label1.textContent = 'NODES';
        if (label2) label2.textContent = 'JOBS';
        if (label3) label3.textContent = 'TRAFFIC';
        if (label4) label4.textContent = 'ACCESS';
        // Labels 5/6 (GPU/MEM) are static in HTML for now or can be set here
        if (label5) label5.textContent = 'GPU';
        if (label6) label6.textContent = 'MEM';

        // Values are updated via telemetry_update
    } else {
        // Workflow Mode
        if (label1) label1.textContent = 'DATASETS';
        if (label2) label2.textContent = 'IMAGES';
        if (label3) label3.textContent = 'COST';
        if (label4) label4.textContent = 'STATUS';

        const totalImages: number = state.selectedDatasets.reduce((sum: number, ds: Dataset) => sum + ds.imageCount, 0);
        const totalCost: number = state.costEstimate.total;

        if (datasetsEl) datasetsEl.textContent = state.selectedDatasets.length.toString();
        if (imagesEl) imagesEl.textContent = totalImages.toLocaleString();
        if (costEl) costEl.textContent = `$${totalCost.toFixed(0)}`;

        if (statusEl) {
            const statusMap: Record<AppState['currentStage'], string> = {
                login: 'LOCKED',
                'role-selection': 'AWAITING ROLE',
                search: 'SEARCHING',
                gather: 'GATHERING',
                process: 'PROCESSING',
                monitor: 'TRAINING',
                post: 'COMPLETE'
            };
            statusEl.textContent = statusMap[state.currentStage] || 'READY';
        }
    }
}

let telemetryCycle = 0;

/**
 * Updates real-time system telemetry numbers (btop effect).
 */
function telemetry_update(): void {
    if (state.currentStage !== 'login' && state.currentStage !== 'role-selection') return;

    telemetryCycle++;

    // Update Process List (Simulated `top`)
    const procEl: HTMLElement | null = document.getElementById('tele-proc');
    if (procEl) {
        const procs = [
            { pid: 1492, usr: 'root', cpu: (Math.random() * 80).toFixed(1), mem: '1.2', cmd: 'kube-apiserver' },
            { pid: 1503, usr: 'root', cpu: (Math.random() * 40).toFixed(1), mem: '4.5', cmd: 'etcd' },
            { pid: 8821, usr: 'atlas', cpu: (Math.random() * 95).toFixed(1), mem: '12.4', cmd: 'python3 train.py' },
            { pid: 2201, usr: 'root', cpu: (Math.random() * 10).toFixed(1), mem: '0.8', cmd: 'containerd' },
            { pid: 3392, usr: 'atlas', cpu: (Math.random() * 5).toFixed(1), mem: '0.4', cmd: 'argus-agent' }
        ];
        
        // Sort by CPU
        procs.sort((a, b) => parseFloat(b.cpu) - parseFloat(a.cpu));
        
        let html = '<span class="dim">  PID USER     %CPU %MEM COMMAND</span>\n';
        procs.forEach(p => {
            const cpuClass = parseFloat(p.cpu) > 80 ? 'warn' : 'highlight';
            html += `<span class="${cpuClass}">${p.pid.toString().padEnd(5)} ${p.usr.padEnd(8)} ${p.cpu.padStart(4)} ${p.mem.padStart(4)} ${p.cmd}</span>\n`;
        });
        procEl.innerHTML = html;
    }

    // Update Network (Simulated `ifconfig` / activity)
    const netEl: HTMLElement | null = document.getElementById('tele-net');
    if (netEl) {
        const eth0_rx = (42 + telemetryCycle * 0.1 + Math.random()).toFixed(2);
        const eth0_tx = (12 + telemetryCycle * 0.05 + Math.random()).toFixed(2);
        const tun0_rx = (8 + Math.random() * 2).toFixed(2);
        
        let html = '<span class="dim">IFACE    RX (GB)   TX (GB)   STATUS</span>\n';
        html += `eth0     ${eth0_rx.padStart(7)}   ${eth0_tx.padStart(7)}   <span class="highlight">UP 1000Mb</span>\n`;
        html += `tun0     ${tun0_rx.padStart(7)}   0008.12   <span class="highlight">UP VPN</span>\n`;
        html += `docker0  0042.11   0041.88   <span class="dim">UP</span>\n`;
        netEl.innerHTML = html;
    }

    // Update Logs (Scrolling text)
    const logEl: HTMLElement | null = document.getElementById('tele-log');
    if (logEl) {
        const events = [
            '[KERN] Tainted: P           O      5.15.0-1031-aws #35~20.04.1',
            '[AUTH] pam_unix(sshd:session): session opened for user atlas',
            '[K8S ] Pod/default/trainer-x86-04 scheduled on node-04',
            '[NET ] eth0: promiscuous mode enabled',
            '[WARN] GPU-0: Temperature 82C, fan speed 100%',
            '[INFO] ATLAS Federation Link: Heartbeat received from MGH',
            '[INFO] ATLAS Federation Link: Heartbeat received from BCH',
            '[AUDIT] User access granted: dev-001 from 10.0.4.2'
        ];
        
        // Pick a random event occasionally
        if (Math.random() > 0.7) {
            const time = new Date().toISOString().split('T')[1].slice(0,8);
            const event = events[Math.floor(Math.random() * events.length)];
            const line = `${time} ${event}`;
            
            // Append and scroll
            const lines = (logEl.innerText + '\n' + line).split('\n').slice(-5); // Keep last 5 lines
            logEl.innerText = lines.join('\n');
        }
    }
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
    const gutter = document.getElementById(`gutter-${section}`);
    if (gutter) {
        gutter.setAttribute('data-status', status);
    }
}

/**
 * Resets all gutter sections to idle.
 */
function gutter_resetAll(): void {
    for (let i = 1; i <= 5; i++) {
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
 * Logs the user out and resets the application state.
 */
function user_logout(): void {
    // Reset state
    state.currentStage = 'login';
    state.selectedDatasets = [];
    state.virtualFilesystem = null;
    state.costEstimate = { dataAccess: 0, compute: 0, storage: 0, total: 0 };
    state.trainingJob = null;

    // Reset UI components
    const loginUser = document.getElementById('login-user') as HTMLInputElement;
    const loginPass = document.getElementById('login-pass') as HTMLInputElement;
    if (loginUser) loginUser.value = '';
    if (loginPass) loginPass.value = '';

    const btn = document.querySelector('.login-form button') as HTMLButtonElement;
    if (btn) {
        btn.textContent = 'INITIATE SESSION';
        btn.classList.remove('pulse');
    }
    
    // Clear visited stages
    visitedStages.clear();

    // Reset gutters
    gutter_resetAll();
    gutter_setStatus(1, 'active');

    // Navigate to login
    stage_advanceTo('login');
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
    cascade_update();
}

/**
 * Updates the selection count display and button state.
 */
function selectionCount_update(): void {
    const count = state.selectedDatasets.length;
    const countEl = document.getElementById('selection-count');
    const btnToGather = document.getElementById('btn-to-gather') as HTMLButtonElement;

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
                children: state.selectedDatasets.map(ds => {
                    // Extract provider code from thumbnail path
                    const parts = ds.thumbnail.split('/');
                    const providerCode = parts.length > 2 ? parts[1] : 'UNK';
                    
                    // Generate image nodes based on count
                    const imageNodes: FileNode[] = [];
                    for (let i = 1; i <= ds.imageCount; i++) {
                        // Special handling for exemplars
                        if (providerCode === 'WBC') {
                            const fileName = `WBC_${String(i).padStart(3, '0')}.bmp`;
                            imageNodes.push({
                                name: fileName,
                                type: 'image',
                                path: `data/WBC/images/${fileName}`
                            });
                        } else if (providerCode === 'KaggleBrain') {
                            // Map index to real filenames (0010 to 0029)
                            const num = 10 + (i - 1);
                            const fileName = `Tr-gl_${String(num).padStart(4, '0')}.jpg`;
                            imageNodes.push({
                                name: fileName,
                                type: 'image',
                                path: `data/KaggleBrain/Training/glioma/${fileName}`
                            });
                        } else {
                            const fileName = `${providerCode}_${String(i).padStart(3, '0')}.jpg`;
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
                        for (let i = 1; i <= ds.imageCount; i++) {
                            if (providerCode === 'WBC') {
                                const maskName = `WBC_${String(i).padStart(3, '0')}_mask.png`;
                                maskNodes.push({
                                    name: maskName,
                                    type: 'image',
                                    path: `data/WBC/masks/${maskName}`
                                });
                            } else if (providerCode === 'KaggleBrain') {
                                const num = 10 + (i - 1);
                                const maskName = `Tr-gl_${String(num).padStart(4, '0')}_mask.png`;
                                maskNodes.push({
                                    name: maskName,
                                    type: 'image',
                                    path: `data/KaggleBrain/masks/${maskName}`
                                });
                            } else {
                                const maskName = `${providerCode}_${String(i).padStart(3, '0')}_mask.png`;
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
        preview.innerHTML = `<p class="dim">File preview not available</p>`;
    } else {
        preview.innerHTML = `<p class="dim">Select a file to preview</p>`;
    }
}

/**
 * Calculates and displays cost estimates.
 */
function costs_calculate(): void {
    state.costEstimate = costEstimate_calculate(state.selectedDatasets);

    const costData = document.getElementById('cost-data');
    const costCompute = document.getElementById('cost-compute');
    const costStorage = document.getElementById('cost-storage');
    const costTotal = document.getElementById('cost-total');

    if (costData) costData.textContent = `$${state.costEstimate.dataAccess.toFixed(2)}`;
    if (costCompute) costCompute.textContent = `$${state.costEstimate.compute.toFixed(2)}`;
    if (costStorage) costStorage.textContent = `$${state.costEstimate.storage.toFixed(2)}`;
    if (costTotal) costTotal.textContent = `$${state.costEstimate.total.toFixed(2)}`;

    cascade_update();
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

    // Pulse gutter during training
    const gutterIndex = Math.floor(job.currentEpoch) % 5 + 1;
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
    if (!lossChart || !state.trainingJob) return;
    const { ctx } = lossChart;
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

    // Set all gutters to success
    for (let i = 1; i <= 5; i++) {
        gutter_setStatus(i, 'success');
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

    // Set gutter to error
    gutter_setStatus(4, 'error');

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
function app_initialize(): void {
    // Display version
    version_display();

    // Start clock
    clock_update();
    setInterval(clock_update, 1000);

    // Initialize persona buttons
    personaButtons_initialize();

    // Initialize stage indicators
    stageIndicators_initialize();

    // Initial search
    catalog_search();

    // Initialize cascade
    cascade_update();

    // Start Telemetry
    setInterval(telemetry_update, 500);
    stationTelemetry_start();

    // Set initial gutter state
    gutter_setStatus(1, 'active');

    // Handle initial login state
    stage_advanceTo(state.currentStage);

    // Expose functions to window for onclick handlers
    (window as unknown as Record<string, unknown>).stage_advanceTo = stage_advanceTo;
    (window as unknown as Record<string, unknown>).station_click = station_click;
    (window as unknown as Record<string, unknown>).stage_next = stage_next;
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
