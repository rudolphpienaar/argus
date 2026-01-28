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
import { cascade_update } from './core/logic/telemetry.js';
import { stage_advanceTo, stage_next, station_click, stageIndicators_initialize, STAGE_ORDER, stageButton_setEnabled } from './core/logic/navigation.js';
import { filesystem_build, filePreview_show, costs_calculate, selectionCount_update } from './core/stages/gather.js';
import { training_launch, terminal_toggle, ide_openFile } from './core/stages/process.js';
import { gutter_setStatus, gutter_resetAll } from './ui/gutters.js';
import { monitor_initialize, training_abort } from './core/stages/monitor.js';
import { model_publish } from './core/stages/post.js';
import { user_authenticate, user_logout, role_select, persona_switch, personaButtons_initialize } from './core/stages/login.js';
import { marketplace_initialize } from './marketplace/view.js';
import { catalog_search, dataset_toggle, dataset_select, dataset_deselect, workspace_render, lcarslm_simulate, lcarslm_auth, lcarslm_reset, lcarslm_initialize, project_activate } from './core/stages/search.js';
import { telemetry_start } from './telemetry/manager.js';
import { WorkflowTracker } from './lcars-framework/ui/WorkflowTracker.js';
import { LCARSTerminal } from './ui/components/Terminal.js';
import { LCARSEngine } from './lcarslm/engine.js';
import './ui/components/LCARSFrame.js';  // LCARS procedural frame generator
import { FrameSlot } from './ui/components/FrameSlot.js';
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
let workflowTracker: WorkflowTracker | null = null;

// ============================================================================
// SeaGaP Station Functions
// ============================================================================

/**
 * Initializes the SeaGaP workflow tracker.
 */
function workflow_initialize(): void {
    console.log('[ARGUS] Initializing WorkflowTracker...', STAGE_ORDER);
    workflowTracker = new WorkflowTracker({
        elementId: 'seagap-panel',
        stations: STAGE_ORDER.map(stage => ({
            id: stage,
            label: stage.toUpperCase(),
            hasTelemetry: true
        })),
        onStationClick: (stageId) => station_click(stageId)
    });
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
        const newHeight: number = Math.max(0, startHeight + deltaY);
        
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

        // Sync FrameSlot slide state after drag completes
        if (globals.frameSlot) {
            globals.frameSlot.state_syncAfterDrag();
        }
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
    telemetry_start();
    workflow_initialize();


    // Set initial gutter state
    gutter_setStatus(1, 'active');

    // Initialize Global Intelligence Console
    terminal = new LCARSTerminal('intelligence-console');
    globals.terminal = terminal;
    terminal.onUnhandledCommand = terminal_handleCommand;

    // Initialize Frame Slot for two-phase terminal animation
    const consoleBootEl: HTMLElement | null = document.getElementById('intelligence-console');
    const terminalWrapper: HTMLElement | null = consoleBootEl?.querySelector('.lcars-terminal-wrapper') as HTMLElement;
    const bar10El: HTMLElement | null = document.querySelector('.bar-10');
    if (consoleBootEl && terminalWrapper) {
        globals.frameSlot = new FrameSlot({
            frameElement: consoleBootEl,
            contentElement: terminalWrapper,
            frameDuration: 600,
            slideDuration: 400,
            openHeight: '600px',
            onOpen: () => {
                // Stop beckoning bar-10 when the terminal is open
                if (bar10El) bar10El.classList.remove('lcars-beckon');
            },
            onClose: () => {
                // Resume beckoning bar-10 when the terminal is closed
                if (bar10El) bar10El.classList.add('lcars-beckon');
            },
        });

        // Bar-10 starts beckoning (terminal starts closed)
        if (bar10El) bar10El.classList.add('lcars-beckon');
    }

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
                if (globals.frameSlot) {
                    setTimeout(() => globals.frameSlot.frame_open(), 10);
                }
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
                if (globals.frameSlot) {
                    globals.frameSlot.frame_open();
                }
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
