/**
 * @file Process Stage Lifecycle
 *
 * Handles Process-stage enter/exit transitions and terminal mode changes.
 *
 * @module core/stages/process/lifecycle
 */

import { store } from '../../state/store.js';
import type { LCARSTerminal } from '../../../ui/components/Terminal.js';
import { projectDir_populate } from '../../../vfs/providers/ProjectProvider.js';
import { populate_ide } from './ide/view.js';

interface ProcessContext {
    projectName: string;
    username: string;
}

/**
 * Process-stage enter hook.
 */
export function stage_enter(): void {
    const context: ProcessContext = processContext_resolve();
    projectDir_populate(store.globals.vcs, context.username, context.projectName);

    terminalDeveloperMode_enable(context.projectName);
    frameSlot_open();
    populate_ide();
}

/**
 * Process-stage exit hook.
 */
export function stage_exit(): void {
    terminalDeveloperMode_disable();
}

/**
 * Resolve active project context from shell store.state.
 */
function processContext_resolve(): ProcessContext {
    return {
        projectName: store.globals.shell?.env_get('PROJECT') || 'default',
        username: store.globals.shell?.env_get('USER') || 'user',
    };
}

/**
 * Enable developer-mode terminal presentation and bootstrap banner.
 */
function terminalDeveloperMode_enable(projectName: string): void {
    const terminal: LCARSTerminal | null = store.globals.terminal;
    const terminalScreen: HTMLElement | null = terminalScreen_resolve();

    if (terminalScreen) {
        terminalScreen.classList.add('developer-mode');
    }

    if (!terminal) {
        return;
    }

    terminal.clear();
    terminal.println('○ ENVIRONMENT: BASH 5.2.15 // ARGUS CORE v1.4.5');
    terminal.println(`● PROJECT MOUNTED AT ~/projects/${projectName}`);
    terminal.println('○ RUN "ls" TO VIEW ASSETS OR "federate train.py" TO INITIATE FEDERATION.');
}

/**
 * Disable developer-mode terminal presentation.
 */
function terminalDeveloperMode_disable(): void {
    const terminalScreen: HTMLElement | null = terminalScreen_resolve();
    if (terminalScreen) {
        terminalScreen.classList.remove('developer-mode');
    }
}

/**
 * Resolve the terminal screen element for styling toggles.
 */
function terminalScreen_resolve(): HTMLElement | null {
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');
    return consoleEl?.querySelector('.lcars-terminal-screen') as HTMLElement | null;
}

/**
 * Open FrameSlot if available.
 */
function frameSlot_open(): void {
    store.globals.frameSlot?.frame_open();
}
