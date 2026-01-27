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

import { state, globals, store } from './core/state/store.js';
import { costEstimate_calculate } from './core/logic/costs.js';
import { filesystem_create } from './core/logic/filesystem.js';
import { DATASETS } from './core/data/datasets.js';
import { MOCK_PROJECTS } from './core/data/projects.js';
import { MOCK_NODES } from './core/data/nodes.js';
import { cascade_update, telemetry_update } from './core/logic/telemetry.js';
import { stage_advanceTo, stage_next, station_click, stageIndicators_initialize, STAGE_ORDER, stageButton_setEnabled } from './core/logic/navigation.js';
import { filesystem_build, filePreview_show, costs_calculate, selectionCount_update } from './core/stages/gather.js';
import { training_launch, terminal_toggle, ide_openFile } from './core/stages/process.js';
import { gutter_setStatus, gutter_resetAll } from './ui/gutters.js';
import { monitor_initialize, training_abort } from './core/stages/monitor.js';
import { model_publish } from './core/stages/post.js';
import { user_authenticate, user_logout, role_select, persona_switch, personaButtons_initialize } from './core/stages/login.js';
import { marketplace_initialize } from './marketplace/view.js';
import { catalog_search, dataset_toggle, dataset_select, dataset_deselect, workspace_render, lcarslm_simulate, lcarslm_auth, lcarslm_reset, lcarslm_initialize, project_activate } from './core/stages/search.js';
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

// State is now imported from core/state/store.ts

let terminal: LCARSTerminal | null = null;

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

// ============================================================================
// AI / Auth Logic
// ============================================================================

// AI/Auth functions have been moved to core/stages/search.ts

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

    // Terminal-Driven Workflow Commands
    if (cmd === 'search') {
        const query = args.join(' ');
        terminal.println(`○ SEARCHING CATALOG FOR: "${query}"...`);
        stage_advanceTo('search');
        const searchInput = document.getElementById('search-query') as HTMLInputElement;
        if (searchInput) {
            searchInput.value = query;
            const results = await catalog_search(query);
            
            if (results && results.length > 0) {
                terminal.println(`● FOUND ${results.length} MATCHING DATASETS:`);
                results.forEach(ds => {
                    if (terminal) terminal.println(`  [<span class="highlight">${ds.id}</span>] ${ds.name} (${ds.modality}/${ds.annotationType})`);
                });
            } else {
                terminal.println(`○ NO MATCHING DATASETS FOUND.`);
            }
        }
        return;
    }

    if (cmd === 'add') {
        const targetId = args[0];
        const dataset = DATASETS.find(ds => ds.id === targetId || ds.name.toLowerCase().includes(targetId.toLowerCase()));
        if (dataset) {
            dataset_toggle(dataset.id);
        } else {
            terminal.println(`<span class="error">>> ERROR: DATASET "${targetId}" NOT FOUND.</span>`);
        }
        return;
    }

    if (cmd === 'review' || cmd === 'gather') {
        terminal.println(`● INITIATING COHORT REVIEW...`);
        stage_advanceTo('gather');
        return;
    }

    if (cmd === 'mount') {
        terminal.println(`● MOUNTING VIRTUAL FILESYSTEM...`);
        filesystem_build();
        costs_calculate();
        stage_advanceTo('process');
        terminal.println(`<span class="success">>> MOUNT COMPLETE. FILESYSTEM READY.</span>`);
        return;
    }

    if (cmd === 'simulate') {
        terminal.println(`● ACTIVATING SIMULATION PROTOCOLS...`);
        lcarslm_simulate();
        return;
    }

    const query = [cmd, ...args].join(' ');
    
    // Check local globals.lcarsEngine reference (managed by search.ts via store)
    // Actually, we imported 'globals' from store.ts.
    // 'lcarslm_initialize' in search.ts sets 'globals.lcarsEngine'.
    // Here we should check 'globals.lcarsEngine'.
    
    if (globals.lcarsEngine) {
        terminal.println('○ CONTACTING AI CORE... PROCESSING...');
        try {
            const selectedIds: string[] = state.selectedDatasets.map((ds: Dataset) => ds.id);
            const response: QueryResponse = await globals.lcarsEngine.query(query, selectedIds);
            
            // 1. Process Intent: [SELECT: ds-xxx]
            const selectMatch = response.answer.match(/\[SELECT: (ds-[0-9]+)\]/);
            if (selectMatch) {
                const datasetId = selectMatch[1];
                
                // Use Store Action to clear context
                if (state.activeProject) {
                    terminal.println(`○ RESETTING PROJECT CONTEXT [${state.activeProject.name}] FOR NEW SELECTION.`);
                    store.unloadProject();
                    // Force UI to switch from "Project View" to "Dataset Grid"
                    workspace_render(DATASETS, true);
                }

                dataset_select(datasetId);
                terminal.println(`● AFFIRMATIVE. DATASET [${datasetId}] SELECTED AND ADDED TO SESSION BUFFER.`);
            }

            if (response.answer.includes('[ACTION: PROCEED]')) {
                terminal.println('● AFFIRMATIVE. PREPARING GATHER PROTOCOL.');
                setTimeout(stage_next, 1000);
            }

            const cleanAnswer = response.answer
                .replace(/\[SELECT: ds-[0-9]+\]/g, '')
                .replace(/\[ACTION: PROCEED\]/g, '')
                .replace(/\[ACTION: SHOW_DATASETS\]/g, '')
                .replace(/\[FILTER:.*?\]/g, '')
                .trim();

            terminal.println(`<span class="highlight">${cleanAnswer}</span>`);
            
            // Only update the visual grid if the AI indicates a search/list intent
            if (state.currentStage === 'search' && response.answer.includes('[ACTION: SHOW_DATASETS]')) {
                let datasetsToShow = response.relevantDatasets;
                
                // Check for filter instruction
                const filterMatch = response.answer.match(/\[FILTER: (.*?)\]/);
                if (filterMatch) {
                    const ids = filterMatch[1].split(',').map(s => s.trim());
                    datasetsToShow = datasetsToShow.filter(ds => ids.includes(ds.id));
                }
                
                workspace_render(datasetsToShow, true);
            }
        } catch (e: any) {
            const errorMsg = (e.message || 'UNKNOWN ERROR').toLowerCase();
            
            if (errorMsg.includes('quota') || errorMsg.includes('exceeded') || errorMsg.includes('429')) {
                terminal.println(`<span class="error">>> ERROR: RESOURCE QUOTA EXCEEDED. RATE LIMIT ACTIVE.</span>`);
                terminal.println(`<span class="warn">>> STANDBY. RETRY IN 30-60 SECONDS.</span>`);
                terminal.println(`<span class="dim">   (Or type "simulate" to force offline mode)</span>`);
            } else {
                terminal.println(`<span class="error">>> ERROR: UNABLE TO ESTABLISH LINK. ${e.message}</span>`);
            }
        }
    } else {
        terminal.println(`<span class="warn">>> COMMAND NOT RECOGNIZED. AI CORE OFFLINE.</span>`);
        terminal.println(`<span class="dim">>> SYSTEM UNINITIALIZED. PLEASE AUTHENTICATE OR TYPE "simulate".</span>`);
    }
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

    // Initialize Stage Indicators
    stageIndicators_initialize();
    personaButtons_initialize();
    marketplace_initialize();

    // Initialize VFS with Mock Projects
    MOCK_PROJECTS.forEach(project => {
        const root = filesystem_create(project.datasets);
        globals.vfs.mountProject(project.name, root);
    });

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
    globals.terminal = terminal;
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
    (window as any).ide_openFile = ide_openFile;
    (window as any).store = store;
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', app_initialize);
} else {
    app_initialize();
}
