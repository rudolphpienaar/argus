/**
 * @file ARGUS Main Application
 *
 * Entry point for the ARGUS (ATLAS Resource Graphical User System) prototype.
 * Implements the Developer vertical of the SeaGaP-MP workflow:
 * Search, Gather, Process, Monitor, Post.
 *
 * @module
 */

import type { Dataset } from './core/models/types.js';

import { state, globals, store } from './core/state/store.js';
import { Shell } from './vfs/Shell.js';
import { ContentRegistry } from './vfs/content/ContentRegistry.js';
import { ALL_GENERATORS } from './vfs/content/templates/index.js';
import { homeDir_scaffold, projectDir_populate } from './vfs/providers/ProjectProvider.js';
import { cohortTree_build } from './vfs/providers/DatasetProvider.js';
import type { FileNode as VcsFileNode } from './vfs/types.js';
import { DATASETS } from './core/data/datasets.js';
import { MOCK_PROJECTS } from './core/data/projects.js';
import { cascade_update } from './core/logic/telemetry.js';
import { stage_advanceTo, stage_next, station_click, stageIndicators_initialize, STAGE_ORDER } from './core/logic/navigation.js';
import { filesystem_build, filePreview_show, costs_calculate } from './core/stages/gather.js';
import { training_launch, terminal_toggle, ide_openFile } from './core/stages/process.js';
import { gutter_setStatus } from './ui/gutters.js';
import { monitor_initialize, training_abort } from './core/stages/monitor.js';
import { model_publish } from './core/stages/post.js';
import { user_authenticate, user_logout, role_select, persona_switch, personaButtons_initialize } from './core/stages/login.js';
import { marketplace_initialize } from './marketplace/view.js';
import { catalog_search, dataset_toggle, dataset_select, workspace_render, lcarslm_simulate, lcarslm_auth, lcarslm_reset, lcarslm_initialize, project_activate, projectDetail_open } from './core/stages/search.js';
import { telemetry_start } from './telemetry/manager.js';
import { WorkflowTracker } from './lcars-framework/ui/WorkflowTracker.js';
import { LCARSTerminal } from './ui/components/Terminal.js';
import './ui/components/LCARSFrame.js';
import { FrameSlot } from './ui/components/FrameSlot.js';
import type { QueryResponse } from './lcarslm/types.js';
import { VERSION, GIT_HASH } from './generated/version.js';
import type { Project } from './core/models/types.js';

// ============================================================================
// Global Window Extensions
// ============================================================================

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
        project_activate: typeof project_activate;
        projectDetail_open: typeof import('./core/stages/search.js').projectDetail_open;
        ide_openFile: typeof ide_openFile;
        store: typeof store;
    }
}

// ============================================================================
// Module State
// ============================================================================

let terminal: LCARSTerminal | null = null;
let workflowTracker: WorkflowTracker | null = null;

// ============================================================================
// Initialization Helpers
// ============================================================================

/**
 * Initializes the SeaGaP workflow tracker panel.
 */
function workflow_initialize(): void {
    workflowTracker = new WorkflowTracker({
        elementId: 'seagap-panel',
        stations: STAGE_ORDER.map((stage: string): { id: string; label: string; hasTelemetry: boolean } => ({
            id: stage,
            label: stage.toUpperCase(),
            hasTelemetry: true
        })),
        onStationClick: (stageId: string): void => station_click(stageId)
    });
}

/**
 * Initializes the VCS: ContentRegistry, home directory, and project mounts.
 */
function vcs_initialize(): void {
    const contentRegistry: ContentRegistry = new ContentRegistry();
    contentRegistry.generators_registerAll(ALL_GENERATORS);
    contentRegistry.vfs_connect(globals.vcs);

    homeDir_scaffold(globals.vcs, 'user');

    MOCK_PROJECTS.forEach((project: Project): void => {
        const projectBase: string = `/home/user/projects/${project.name}`;
        globals.vcs.dir_create(`${projectBase}/src`);
        const cohortRoot: VcsFileNode = cohortTree_build(project.datasets);
        globals.vcs.tree_mount(`${projectBase}/data`, cohortRoot);
    });
}

/**
 * Initializes the terminal, Shell, and FrameSlot animation system.
 */
function terminal_initialize(): void {
    terminal = new LCARSTerminal('intelligence-console');
    globals.terminal = terminal;

    const shell: Shell = new Shell(globals.vcs, 'user');
    globals.shell = shell;
    terminal.shell_connect(shell);
    terminal.fallback_set(terminalCommand_handle);

    frameSlot_initialize();
}

/**
 * Initializes the FrameSlot two-phase animation for the console.
 */
function frameSlot_initialize(): void {
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
            onOpen: (): void => {
                if (bar10El) bar10El.classList.remove('lcars-beckon');
            },
            onClose: (): void => {
                if (bar10El) bar10El.classList.add('lcars-beckon');
            },
        });

        if (bar10El) bar10El.classList.add('lcars-beckon');
    }
}

/**
 * Registers all window-level function bindings for HTML onclick handlers.
 */
function windowBindings_register(): void {
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
    window.project_activate = project_activate;
    window.projectDetail_open = projectDetail_open;
    window.ide_openFile = ide_openFile;
    window.store = store;
}

// ============================================================================
// Clock & Version
// ============================================================================

/**
 * Updates the LCARS clock display with current time and date.
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
 * Displays the application version in the header.
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
 * @param event - The click event.
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
 * Initializes the draggable Access Strip for console height adjustment.
 */
function terminalDraggable_initialize(): void {
    const strip: HTMLElement | null = document.getElementById('access-strip');
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');

    if (!strip || !consoleEl) return;

    let isDragging: boolean = false;
    let startY: number = 0;
    let startHeight: number = 0;

    strip.addEventListener('mousedown', (e: MouseEvent): void => {
        isDragging = true;
        startY = e.clientY;
        startHeight = consoleEl.offsetHeight;
        strip.classList.add('active');
        document.body.style.cursor = 'ns-resize';

        if (!consoleEl.classList.contains('open')) {
            consoleEl.classList.add('open');
        }
    });

    window.addEventListener('mousemove', (e: MouseEvent): void => {
        if (!isDragging) return;

        const deltaY: number = e.clientY - startY;
        const newHeight: number = Math.max(0, startHeight + deltaY);

        consoleEl.style.height = `${newHeight}px`;
        consoleEl.style.transition = 'none';

        if (newHeight > 50) {
            consoleEl.classList.add('open');
        } else {
            consoleEl.classList.remove('open');
        }
    });

    window.addEventListener('mouseup', (): void => {
        if (!isDragging) return;
        isDragging = false;
        strip.classList.remove('active');
        document.body.style.cursor = 'default';
        consoleEl.style.transition = '';

        if (globals.frameSlot) {
            globals.frameSlot.state_syncAfterDrag();
        }
    });
}

// ============================================================================
// Terminal Fallback Command Handler
// ============================================================================

/**
 * Handles workflow commands typed into the terminal.
 * Routes search, add, review, mount, and simulate commands
 * before falling through to the AI engine for natural language queries.
 *
 * @param cmd - The base command string.
 * @param args - The command arguments.
 */
async function terminalCommand_handle(cmd: string, args: string[]): Promise<void> {
    if (!terminal) return;

    if (workflowCommand_handle(cmd, args)) return;

    await aiQuery_handle(cmd, args);
}

/**
 * Handles known workflow commands (search, add, review, mount, simulate).
 *
 * @param cmd - The command string.
 * @param args - The command arguments.
 * @returns True if the command was handled, false to fall through.
 */
function workflowCommand_handle(cmd: string, args: string[]): boolean {
    if (!terminal) return false;

    if (cmd === 'search') {
        const query: string = args.join(' ');
        terminal.println(`○ SEARCHING CATALOG FOR: "${query}"...`);
        stage_advanceTo('search');
        const searchInput: HTMLInputElement | null = document.getElementById('search-query') as HTMLInputElement;
        if (searchInput) {
            searchInput.value = query;
            catalog_search(query).then((results: Dataset[]): void => {
                if (!terminal) return;
                if (results && results.length > 0) {
                    terminal.println(`● FOUND ${results.length} MATCHING DATASETS:`);
                    results.forEach((ds: Dataset): void => {
                        if (terminal) terminal.println(`  [<span class="highlight">${ds.id}</span>] ${ds.name} (${ds.modality}/${ds.annotationType})`);
                    });
                } else {
                    terminal.println(`○ NO MATCHING DATASETS FOUND.`);
                }
            });
        }
        return true;
    }

    if (cmd === 'add') {
        const targetId: string = args[0];
        const dataset: Dataset | undefined = DATASETS.find((ds: Dataset): boolean => ds.id === targetId || ds.name.toLowerCase().includes(targetId.toLowerCase()));
        if (dataset) {
            dataset_toggle(dataset.id);
        } else {
            terminal.println(`<span class="error">>> ERROR: DATASET "${targetId}" NOT FOUND.</span>`);
        }
        return true;
    }

    if (cmd === 'review' || cmd === 'gather') {
        terminal.println(`● INITIATING COHORT REVIEW...`);
        stage_advanceTo('gather');
        return true;
    }

    if (cmd === 'mount') {
        terminal.println(`● MOUNTING VIRTUAL FILESYSTEM...`);
        filesystem_build();
        costs_calculate();
        stage_advanceTo('process');
        terminal.println(`<span class="success">>> MOUNT COMPLETE. FILESYSTEM READY.</span>`);
        return true;
    }

    if (cmd === 'simulate') {
        terminal.println(`● ACTIVATING SIMULATION PROTOCOLS...`);
        lcarslm_simulate();
        return true;
    }

    return false;
}

/**
 * Handles natural language queries by routing to the AI engine.
 *
 * @param cmd - The command string.
 * @param args - The command arguments.
 */
async function aiQuery_handle(cmd: string, args: string[]): Promise<void> {
    if (!terminal) return;

    const query: string = [cmd, ...args].join(' ');

    if (globals.lcarsEngine) {
        terminal.println('○ CONTACTING AI CORE... PROCESSING...');
        try {
            const selectedIds: string[] = state.selectedDatasets.map((ds: Dataset): string => ds.id);
            const response: QueryResponse = await globals.lcarsEngine.query(query, selectedIds);

            aiResponse_process(response);
        } catch (e: unknown) {
            const errorMsg: string = (e instanceof Error ? e.message : 'UNKNOWN ERROR').toLowerCase();

            if (errorMsg.includes('quota') || errorMsg.includes('exceeded') || errorMsg.includes('429')) {
                terminal.println(`<span class="error">>> ERROR: RESOURCE QUOTA EXCEEDED. RATE LIMIT ACTIVE.</span>`);
                terminal.println(`<span class="warn">>> STANDBY. RETRY IN 30-60 SECONDS.</span>`);
                terminal.println(`<span class="dim">   (Or type "simulate" to force offline mode)</span>`);
            } else {
                terminal.println(`<span class="error">>> ERROR: UNABLE TO ESTABLISH LINK. ${errorMsg}</span>`);
            }
        }
    } else {
        terminal.println(`<span class="warn">>> COMMAND NOT RECOGNIZED. AI CORE OFFLINE.</span>`);
        terminal.println(`<span class="dim">>> SYSTEM UNINITIALIZED. PLEASE AUTHENTICATE OR TYPE "simulate".</span>`);
    }
}

/**
 * Processes an AI query response — handling select intents, action directives,
 * and dataset filtering.
 *
 * @param response - The AI query response.
 */
function aiResponse_process(response: QueryResponse): void {
    if (!terminal) return;

    const selectMatch: RegExpMatchArray | null = response.answer.match(/\[SELECT: (ds-[0-9]+)\]/);
    if (selectMatch) {
        const datasetId: string = selectMatch[1];

        if (state.activeProject) {
            terminal.println(`○ RESETTING PROJECT CONTEXT [${state.activeProject.name}] FOR NEW SELECTION.`);
            store.project_unload();
            workspace_render(DATASETS, true);
        }

        dataset_select(datasetId);
        terminal.println(`● AFFIRMATIVE. DATASET [${datasetId}] SELECTED AND ADDED TO SESSION BUFFER.`);
    }

    if (response.answer.includes('[ACTION: PROCEED]')) {
        terminal.println('● AFFIRMATIVE. PREPARING GATHER PROTOCOL.');
        setTimeout(stage_next, 1000);
    }

    const cleanAnswer: string = response.answer
        .replace(/\[SELECT: ds-[0-9]+\]/g, '')
        .replace(/\[ACTION: PROCEED\]/g, '')
        .replace(/\[ACTION: SHOW_DATASETS\]/g, '')
        .replace(/\[FILTER:.*?\]/g, '')
        .trim();

    terminal.println(`<span class="highlight">${cleanAnswer}</span>`);

    if (state.currentStage === 'search' && response.answer.includes('[ACTION: SHOW_DATASETS]')) {
        let datasetsToShow: Dataset[] = response.relevantDatasets;

        const filterMatch: RegExpMatchArray | null = response.answer.match(/\[FILTER: (.*?)\]/);
        if (filterMatch) {
            const ids: string[] = filterMatch[1].split(',').map((s: string): string => s.trim());
            datasetsToShow = datasetsToShow.filter((ds: Dataset): boolean => ids.includes(ds.id));
        }

        workspace_render(datasetsToShow, true);
    }
}

// ============================================================================
// Stage Change Listener
// ============================================================================

/**
 * Handles stage transition events — controls terminal visibility,
 * developer mode, Shell stage_enter, and prompt synchronization.
 *
 * @param event - The stage-change custom event.
 */
function stageChange_handle(event: CustomEvent): void {
    const stageName: string = event.detail.stage;
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');
    const terminalScreen: HTMLElement | null = consoleEl?.querySelector('.lcars-terminal-screen') as HTMLElement;

    if (consoleEl && terminal) {
        const isEntryStage: boolean = stageName === 'login' || stageName === 'role-selection';

        if (isEntryStage) {
            consoleEl.style.display = 'none';
        } else {
            consoleEl.style.display = 'block';
        }

        if (terminalScreen) {
            terminalScreen.classList.remove('developer-mode');
        }

        if (globals.shell) {
            globals.shell.stage_enter(stageName);
        }

        if (stageName === 'search') {
            const slot: FrameSlot | null = globals.frameSlot;
            if (slot) {
                setTimeout(() => { slot.frame_open(); }, 10);
            }
        } else if (stageName === 'process') {
            const projectName: string = globals.shell?.env_get('PROJECT') || 'default';
            projectDir_populate(globals.vcs, 'user', projectName);
            terminal.clear();
            if (terminalScreen) {
                terminalScreen.classList.add('developer-mode');
            }
            terminal.println('○ ENVIRONMENT: BASH 5.2.15 // ARGUS CORE v1.4.5');
            terminal.println(`● PROJECT MOUNTED AT ~/projects/${projectName}`);
            terminal.println('○ RUN "ls" TO VIEW ASSETS OR "federate train.py" TO INITIATE FEDERATION.');
            if (globals.frameSlot) {
                globals.frameSlot.frame_open();
            }
        }

        terminal.prompt_sync();
    }
}

// ============================================================================
// Application Entry Point
// ============================================================================

/**
 * Initializes the ARGUS application.
 * Orchestrates subsystem startup in the correct order:
 * UI → VCS → Telemetry → Terminal → Stage.
 */
function app_initialize(): void {
    // UI basics
    version_display();
    clock_update();
    setInterval(clock_update, 1000);

    // Stage & marketplace UI
    stageIndicators_initialize();
    personaButtons_initialize();
    marketplace_initialize();

    // Virtual Computer System
    vcs_initialize();

    // Initial render
    workspace_render([], false);
    cascade_update();

    // Telemetry & workflow
    telemetry_start();
    workflow_initialize();
    gutter_setStatus(1, 'active');

    // Terminal & Shell
    terminal_initialize();

    // Stage change listener
    document.addEventListener('argus:stage-change', stageChange_handle as EventListener);

    // Draggable console strip
    terminalDraggable_initialize();

    // AI engine
    lcarslm_initialize();

    // Initial stage
    stage_advanceTo(state.currentStage);

    // Window bindings for HTML onclick handlers
    windowBindings_register();
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', app_initialize);
} else {
    app_initialize();
}
