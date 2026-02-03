/**
 * @file ARGUS Application Orchestrator
 *
 * The main entry point for the ARGUS prototype.
 *
 * RESPONSIBILITIES:
 * 1. Orchestrate subsystem initialization (VCS, Telemetry, Terminal).
 * 2. Manage high-level event delegation (Stage transitions).
 * 3. Bootstrap the UI.
 *
 * NOTE: Business logic is delegated to specialized modules:
 * - Command Routing -> src/core/logic/commands.ts
 * - AI RAG Logic -> src/lcarslm/AIService.ts
 * - Stage Setup -> src/core/stages/* (stage_enter/stage_exit hooks)
 * - DOM Bindings -> src/core/logic/WindowBindings.ts
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
import { training_abort } from './core/stages/monitor.js';
import { model_publish } from './core/stages/post.js';
import { user_authenticate, user_logout, role_select, persona_switch, personaButtons_initialize } from './core/stages/login.js';
import { marketplace_initialize } from './marketplace/view.js';
import { catalog_search, dataset_toggle, dataset_select, workspace_render, lcarslm_simulate, lcarslm_auth, lcarslm_reset, lcarslm_initialize, project_activate, projectDetail_open, datasetDetail_open } from './core/stages/search.js';
import { telemetry_start } from './telemetry/manager.js';
import { WorkflowTracker } from './lcars-framework/ui/WorkflowTracker.js';
import { LCARSTerminal } from './ui/components/Terminal.js';
import './ui/components/LCARSFrame.js';
import { FrameSlot } from './ui/components/FrameSlot.js';
import { command_dispatch } from './core/logic/commands.js';
import { VERSION, GIT_HASH } from './generated/version.js';
import type { Project } from './core/models/types.js';
import { windowBindings_initialize } from './core/logic/WindowBindings.js';

import * as searchStage from './core/stages/search.js';
import * as processStage from './core/stages/process.js';
import * as monitorStage from './core/stages/monitor.js';
import * as loginStage from './core/stages/login.js';
import * as postStage from './core/stages/post.js';
import * as gatherStage from './core/stages/gather.js';

// ============================================================================
// Module State
// ============================================================================

let terminal: LCARSTerminal | null = null;
let workflowTracker: WorkflowTracker | null = null;

/** Interface for modules that provide stage lifecycle hooks. */
interface StageHandler {
    stage_enter?: () => void;
    stage_exit?: () => void;
}

/** Mapping of stage names to their lifecycle handlers. */
const STAGE_HANDLERS: Record<string, StageHandler> = {
    'login': { stage_enter: (): void => {}, stage_exit: (): void => {} },
    'role-selection': { stage_enter: (): void => {}, stage_exit: (): void => {} },
    'search': searchStage,
    'gather': gatherStage,
    'process': processStage,
    'monitor': monitorStage,
    'post': postStage
};

let currentStageName: string = 'login';

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
    terminal.fallback_set(command_dispatch);

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
// Stage Change Listener
// ============================================================================

/**
 * Handles stage transition events — controls terminal visibility,
 * Shell stage_enter, and calls stage-specific lifecycle hooks.
 *
 * @param event - The stage-change custom event.
 */
function stageChange_handle(event: CustomEvent): void {
    const stageName: string = event.detail.stage;
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');

    if (consoleEl && terminal) {
        // 1. Teardown current stage
        const oldHandler = STAGE_HANDLERS[currentStageName];
        if (oldHandler && typeof oldHandler.stage_exit === 'function') {
            oldHandler.stage_exit();
        }

        // 2. Universal setup
        const isEntryStage: boolean = stageName === 'login' || stageName === 'role-selection';
        consoleEl.style.display = isEntryStage ? 'none' : 'block';

        if (globals.shell) {
            globals.shell.stage_enter(stageName);
        }

        // 3. Initialize new stage
        currentStageName = stageName;
        const newHandler = STAGE_HANDLERS[stageName];
        if (newHandler && typeof newHandler.stage_enter === 'function') {
            newHandler.stage_enter();
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
    windowBindings_initialize({ ui_toggleTopFrame });
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', app_initialize);
} else {
    app_initialize();
}
