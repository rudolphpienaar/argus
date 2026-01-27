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
    Project,
    FileNode,
    TrustedDomainNode,
    TrainingJob,
    CostEstimate,
    AppState
} from './core/models/types.js';

import { costEstimate_calculate } from './core/logic/costs.js';
import { filesystem_create } from './core/logic/filesystem.js';
import { DATASETS } from './core/data/datasets.js';
import { MOCK_PROJECTS } from './core/data/projects.js';
import { MOCK_NODES } from './core/data/nodes.js';
import { cascade_update, telemetry_update } from './core/logic/telemetry.js';
import { stage_advanceTo, stage_next, station_click, stageIndicators_initialize, STAGE_ORDER, stageButton_setEnabled } from './core/logic/navigation.js';
import { filesystem_build, filePreview_show, costs_calculate, selectionCount_update } from './core/stages/gather.js';
import { training_launch, terminal_toggle } from './core/stages/process.js';
import { gutter_setStatus, gutter_resetAll } from './ui/gutters.js';
import { monitor_initialize, training_abort } from './core/stages/monitor.js';
import { model_publish } from './core/stages/post.js';
import { user_authenticate, user_logout, role_select, persona_switch, personaButtons_initialize } from './core/stages/login.js';
import { catalog_search, dataset_toggle, workspace_render } from './core/stages/search.js';
import { LCARSTerminal } from './ui/components/Terminal.js';
import { LCARSEngine } from './lcarslm/engine.js';
import type { QueryResponse } from './lcarslm/types.js';
import { VERSION, GIT_HASH } from './generated/version.js';

// ============================================================================
// Types
// ============================================================================

type Persona = 'developer' | 'annotator' | 'user' | 'provider' | 'scientist' | 'clinician' | 'admin' | 'fda';
type GutterStatus = 'idle' | 'active' | 'success' | 'error';

declare global {
    interface Window {
        stage_advanceTo: typeof stage_advanceTo;
        station_click: typeof station_click;
        stage_next: typeof stage_next;
        catalog_search: typeof catalog_search;
        dataset_toggle: typeof dataset_toggle;
        filePreview_show: typeof filePreview_show;
        training_launch: typeof training_launch;
        training_abort: typeof training_abort;
        model_publish: typeof model_publish;
        persona_switch: typeof persona_switch;
        ui_toggleTopFrame: typeof ui_toggleTopFrame;
        user_authenticate: typeof user_authenticate;
        user_logout: typeof user_logout;
        role_select: typeof role_select;
        lcarslm_auth: typeof lcarslm_auth;
        lcarslm_reset: typeof lcarslm_reset;
        lcarslm_simulate: typeof lcarslm_simulate;
        terminal_toggle: typeof terminal_toggle;
    }
}

// ============================================================================
// Application State
// ============================================================================

const state: AppState & { currentPersona: Persona } = {
    currentPersona: 'developer',
    currentStage: 'login',
    selectedDatasets: [],
    activeProject: null,
    virtualFilesystem: null,
    costEstimate: { dataAccess: 0, compute: 0, storage: 0, total: 0 },
    trainingJob: null
};

let terminal: LCARSTerminal | null = null;
let lcarsEngine: LCARSEngine | null = null;
let trainingInterval: number | null = null;
let lossChart: { ctx: CanvasRenderingContext2D; data: number[] } | null = null;

// ============================================================================
// SeaGaP Station Functions
// ============================================================================

// Station functions have been moved to core/logic/navigation.ts

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
    const stationEl: HTMLElement | null = document.getElementById(`station-${stageName}`);
    if (!stationEl || (!stationEl.classList.contains('active') && !stationEl.classList.contains('visited'))) {
        return;
    }

    const teleEl: HTMLElement | null = document.getElementById(`tele-${stageName}`);
    if (!teleEl) return;

    const contentEl: Element | null = teleEl.querySelector('.tele-content');
    if (!contentEl) return;

    const isActive: boolean = stationEl.classList.contains('active');
    const t: number = telemetryTickCount + (STAGE_ORDER.indexOf(stageName) * 10); // Offset for variety
    const timeStr: string = String(t % 10000).padStart(4, '0');

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

    const generator: (() => string) | undefined = generators[stageName];
    contentEl.innerHTML = generator ? generator() : 'Initializing...';
}


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

// ============================================================================
// Persona Functions
// ============================================================================

// Persona functions have been moved to core/stages/login.ts

// ============================================================================
// Stage Navigation Functions
// ============================================================================

// Navigation functions have been moved to core/logic/navigation.ts

// ============================================================================
// Data Cascade Functions
// ============================================================================

// Cascade functions have been moved to core/logic/telemetry.ts

// Telemetry update function moved to core/logic/telemetry.ts

// ============================================================================
// Gutter Functions
// ============================================================================

// Gutter functions have been moved to ui/gutters.ts

// ============================================================================
// Login Stage Functions
// ============================================================================

// Login functions have been moved to core/stages/login.ts

// ============================================================================
// Persona Functions
// ============================================================================

// Persona functions have been moved to core/stages/login.ts

/**
 * Initializes the LCARSLM Engine if API key is present.
 */
function lcarslm_initialize(): void {
    const apiKey: string | null = localStorage.getItem('ARGUS_API_KEY');
    const provider: string | null = localStorage.getItem('ARGUS_PROVIDER');
    const model: string | null = localStorage.getItem('ARGUS_MODEL') || 'default';
    
    if (apiKey && provider) {
        lcarsEngine = new LCARSEngine({
            apiKey,
            model: model,
            provider: provider as 'openai' | 'gemini'
        });
        searchUI_updateState('ready');
        if (terminal) {
            terminal.setStatus(`MODE: [${provider.toUpperCase()}] // MODEL: [${model.toUpperCase()}]`);
            terminal.println(`>> AI CORE LINK ESTABLISHED: PROVIDER [${provider.toUpperCase()}]`);
        }
    } else {
        searchUI_updateState('auth-required');
    }
}

/**
 * Saves the API key and initializes the engine.
 */
function lcarslm_auth(): void {
    const input: HTMLInputElement = document.getElementById('api-key-input') as HTMLInputElement;
    const modelInput: HTMLInputElement = document.getElementById('api-model-input') as HTMLInputElement;
    const providerSelect: HTMLSelectElement = document.getElementById('api-provider-select') as HTMLSelectElement;
    
    const key: string = input.value.trim();
    const provider: string = providerSelect.value;
    const model: string = modelInput.value.trim() || 'default';

    if (key.length > 5) {
        localStorage.setItem('ARGUS_API_KEY', key);
        localStorage.setItem('ARGUS_PROVIDER', provider);
        localStorage.setItem('ARGUS_MODEL', model);
        lcarslm_initialize();
    } else {
        alert('Invalid Key Format.');
    }
}

/**
 * Resets the API key and UI state.
 */
function lcarslm_reset(): void {
    localStorage.removeItem('ARGUS_API_KEY');
    localStorage.removeItem('ARGUS_PROVIDER');
    localStorage.removeItem('ARGUS_OPENAI_KEY'); // Clean legacy
    lcarsEngine = null;
    searchUI_updateState('auth-required');
}

/**
 * Initializes the engine in simulation mode (no API key required).
 */
function lcarslm_simulate(): void {
    lcarsEngine = new LCARSEngine(null);
    searchUI_updateState('ready');
    if (terminal) {
        terminal.setStatus('MODE: [SIMULATION] // EMULATION ACTIVE');
        terminal.println('>> AI CORE: SIMULATION MODE ACTIVE. EMULATING NEURAL RESPONSES.');
    }
}

function searchUI_updateState(status: 'auth-required' | 'ready'): void {
    const authPanel: HTMLElement | null = document.getElementById('search-auth-panel');
    const queryPanel: HTMLElement | null = document.getElementById('search-query-panel');
    const statusPanel: HTMLElement | null = document.getElementById('search-status-panel');
    
    if (authPanel && queryPanel) {
        if (status === 'ready') {
            authPanel.style.display = 'none';
            queryPanel.style.display = 'block';
            if (statusPanel) statusPanel.style.display = 'block';
        } else {
            authPanel.style.display = 'block';
            queryPanel.style.display = 'none';
            if (statusPanel) statusPanel.style.display = 'none';
        }
    }
}

// ============================================================================
// Search Stage Functions
// ============================================================================

// Search functions have been moved to core/stages/search.ts

// ============================================================================
// Gather Stage Functions
// ============================================================================

// Gather functions have been moved to core/stages/gather.ts

// ============================================================================
// Process Stage Functions
// ============================================================================

// Process functions have been moved to core/stages/process.ts

// ============================================================================
// Monitor Stage Functions
// ============================================================================

// Monitor functions have been moved to core/stages/monitor.ts

// ============================================================================
// Post Stage Functions
// ============================================================================

// Post functions have been moved to core/stages/post.ts

// ============================================================================
// Initialization
// ============================================================================

/**
 * Handles unrecognized terminal commands by routing them to the AI core.
 * 
 * @param cmd - The base command or natural language string.
 * @param args - The arguments.
 */
async function terminal_handleCommand(cmd: string, args: string[]): Promise<void> {
    if (!terminal) return;

    const query: string = [cmd, ...args].join(' ');
    
    if (lcarsEngine) {
        terminal.println('○ CONTACTING AI CORE... PROCESSING...');
        try {
            const selectedIds: string[] = state.selectedDatasets.map(ds => ds.id);
            const response: QueryResponse = await lcarsEngine.query(query, selectedIds);
            
            // 1. Process Intent: [SELECT: ds-xxx]
            const selectMatch = response.answer.match(/\[SELECT: (ds-[0-9]+)\]/);
            if (selectMatch) {
                const datasetId = selectMatch[1];
                dataset_toggle(datasetId);
                terminal.println(`● AFFIRMATIVE. DATASET [${datasetId}] SELECTED AND ADDED TO SESSION BUFFER.`);
            }

            // 2. Process Intent: [ACTION: PROCEED]
            if (response.answer.includes('[ACTION: PROCEED]')) {
                terminal.println('● AFFIRMATIVE. PREPARING GATHER PROTOCOL.');
                setTimeout(stage_next, 1000);
            }

            // 3. Clean and Print the Response
            const cleanAnswer = response.answer
                .replace(/\[SELECT: ds-[0-9]+\]/g, '')
                .replace(/\[ACTION: PROCEED\]/g, '')
                .trim();

            terminal.println(`<span class="highlight">${cleanAnswer}</span>`);
            
            // If we are in search stage and datasets were found, update readout
            if (state.currentStage === 'search') {
                workspace_render(response.relevantDatasets, true);
            }
        } catch (e: any) {
            terminal.println(`<span class="error">>> ERROR: UNABLE TO ESTABLISH LINK. ${e.message}</span>`);
        }
    } else {
        // Local Command Handling (Stub for now, expanded later)
        if (cmd === 'cd') {
            if (args[0] === '..') {
                state.activeProject = null;
                state.selectedDatasets = [];
                terminal.setPrompt('ARGUS: SEARCH >');
                catalog_search(); // Re-render root
                terminal.println('● NAVIGATING TO ROOT WORKSPACE.');
            } else {
                const proj = MOCK_PROJECTS.find(p => p.name === args[0] || p.id === args[0]);
                if (proj) {
                    project_activate(proj.id);
                } else {
                    terminal.println(`<span class="error">>> ERROR: PROJECT '${args[0]}' NOT FOUND.</span>`);
                }
            }
        } else if (cmd === 'ls') {
            if (!state.activeProject) {
                MOCK_PROJECTS.forEach(p => terminal!.println(`<span class="dir">${p.name}/</span>`));
            } else {
                state.activeProject.datasets.forEach(d => terminal!.println(`<span class="file">${d.name}</span>`));
            }
        } else {
            terminal.println(`<span class="warn">>> COMMAND NOT RECOGNIZED. AI CORE OFFLINE.</span>`);
        }
    }
}

/**
 * Activates a project workspace.
 * 
 * @param projectId - The ID of the project to load.
 */
function project_activate(projectId: string): void {
    const project = MOCK_PROJECTS.find(p => p.id === projectId);
    if (!project) return;

    state.activeProject = project;
    state.selectedDatasets = [...project.datasets]; // Copy datasets to active selection
    
    // Update Terminal
    if (terminal) {
        terminal.setPrompt(`ARGUS: ~/${project.name} >`);
        terminal.println(`● MOUNTING PROJECT: [${project.name.toUpperCase()}]`);
        terminal.println(`○ LOADED ${project.datasets.length} DATASETS.`);
    }

    // Update Visuals
    workspace_render(DATASETS, false); // Render all, but selection state will match project
    cascade_update();
}

// ============================================================================
// UI Functions
// ============================================================================

// Terminal toggle moved to process.ts

/**
 * Initializes the draggable Access Strip for console height adjustment.
 */
function terminal_initializeDraggable(): void {
    const strip: HTMLElement | null = document.getElementById('access-strip');
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');
    
    if (!strip || !consoleEl) return;

    let isDragging: boolean = false;
    let startY: number = 0;
    let startHeight: number = 0;

    strip.addEventListener('mousedown', (e: MouseEvent) => {
        isDragging = true;
        startY = e.clientY;
        startHeight = consoleEl.offsetHeight;
        strip.classList.add('active');
        document.body.style.cursor = 'ns-resize';
        
        // Ensure console has 'open' class if dragging starts
        if (!consoleEl.classList.contains('open')) {
            consoleEl.classList.add('open');
        }
    });

    window.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isDragging) return;
        
        const deltaY: number = e.clientY - startY;
        const newHeight: number = Math.max(0, Math.min(window.innerHeight - 400, startHeight + deltaY));
        
        consoleEl.style.height = `${newHeight}px`;
        consoleEl.style.transition = 'none'; // Disable transition during drag
        
        // Synchronize 'open' class for styling
        if (newHeight > 50) {
            consoleEl.classList.add('open');
        } else {
            consoleEl.classList.remove('open');
        }
    });

    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        strip.classList.remove('active');
        document.body.style.cursor = 'default';
        consoleEl.style.transition = ''; // Restore transition
    });
}

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

    // Initial render: Force Project View (root workspace)
    workspace_render([], false);

    // Initialize cascade
    cascade_update();

    // Start Telemetry
    setInterval(telemetry_update, 500);
    stationTelemetry_start();

    // Set initial gutter state
    gutter_setStatus(1, 'active');

    // Initialize Global Intelligence Console
    terminal = new LCARSTerminal('intelligence-console');
    terminal.onUnhandledCommand = terminal_handleCommand;

    // Listen for stage changes to update Terminal
    document.addEventListener('argus:stage-change', ((event: CustomEvent) => {
        const stageName = event.detail.stage;
        const consoleEl = document.getElementById('intelligence-console');
        const terminalScreen = consoleEl?.querySelector('.lcars-terminal-screen') as HTMLElement;

        if (consoleEl && terminal) {
            // Hide terminal on login/role selection, show otherwise
            const isEntryStage: boolean = stageName === 'login' || stageName === 'role-selection';
            
            if (isEntryStage) {
                consoleEl.style.display = 'none';
            } else {
                consoleEl.style.display = 'block';
            }

            // Reset Developer Mode state
            if (terminalScreen) {
                terminalScreen.classList.remove('developer-mode');
            }

            // Contextual Prompt
            if (stageName === 'search') {
                terminal.setPrompt('ARGUS: SEARCH >');
                setTimeout(() => consoleEl.classList.add('open'), 10);
            } else if (stageName === 'gather') {
                terminal.setPrompt('ARGUS: COHORT >');
            } else if (stageName === 'process') {
                // DEVELOPER HUB MODE
                terminal.clear();
                if (terminalScreen) {
                    terminalScreen.classList.add('developer-mode');
                }
                terminal.setPrompt('dev@argus:~/src/project $ ');
                terminal.println('○ ENVIRONMENT: BASH 5.2.15 // ARGUS CORE v1.4.5');
                terminal.println('● PROJECT MOUNTED AT /home/developer/src/project');
                terminal.println('○ RUN "ls" TO VIEW ASSETS OR "python train.py" TO INITIATE FEDERATION.');
                consoleEl.classList.add('open');
            } else {
                terminal.setPrompt('dev@argus:~/ $');
            }
        }
    }) as EventListener);

    // Initialize Draggable Strip
    terminal_initializeDraggable();

    // Initialize LCARSLM (Terminal MUST be ready first)
    lcarslm_initialize();

    // Handle initial login state
    stage_advanceTo(state.currentStage);

    // Expose functions to window for onclick handlers
    window.stage_advanceTo = stage_advanceTo;
    window.station_click = station_click;
    window.stage_next = stage_next;
    window.catalog_search = catalog_search;
    window.dataset_toggle = dataset_toggle;
    window.filePreview_show = filePreview_show;
    window.training_launch = training_launch;
    window.training_abort = training_abort;
    window.model_publish = model_publish;
    window.persona_switch = persona_switch;
    window.ui_toggleTopFrame = ui_toggleTopFrame;
    window.user_authenticate = user_authenticate;
    window.user_logout = user_logout;
    window.role_select = role_select;
    window.lcarslm_auth = lcarslm_auth;
    window.lcarslm_reset = lcarslm_reset;
    window.lcarslm_simulate = lcarslm_simulate;
    window.terminal_toggle = terminal_toggle;
    (window as any).project_activate = project_activate;
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', app_initialize);
} else {
    app_initialize();
}
