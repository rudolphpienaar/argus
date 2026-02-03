/**
 * @file Login and Persona Logic
 *
 * Manages user authentication, session state, and persona switching.
 *
 * @module
 */

import { store, globals } from '../state/store.js';
import { gutter_setStatus, gutter_resetAll } from '../../ui/gutters.js';
import { stage_advanceTo } from '../logic/navigation.js';
import { homeDir_scaffold } from '../../vfs/providers/ProjectProvider.js';

type Persona = 'fedml' | 'appdev' | 'annotator' | 'user' | 'provider' | 'scientist' | 'clinician' | 'admin' | 'fda';

/**
 * Hook called when entering the Login stage.
 */
export function stage_enter(): void {
    // Initialization for login stage if needed
}

/**
 * Hook called when exiting the Login stage.
 */
export function stage_exit(): void {
    // Teardown logic if needed
}

// ============================================================================
// Authentication
// ============================================================================

/**
 * Authenticates the user (mock).
 * Accepts any input and transitions to the role-selection stage
 * after a brief animation.
 */
export function user_authenticate(): void {
    const userInput: HTMLInputElement | null = document.getElementById('login-user') as HTMLInputElement;
    const username: string = userInput?.value.trim() || 'user';

    // Update Shell Identity
    if (globals.shell) {
        const homeDir = `/home/${username}`;
        globals.shell.env_set('USER', username);
        globals.shell.env_set('HOME', homeDir);
        globals.shell.env_set('PWD', homeDir);
        
        // Ensure VFS home exists
        homeDir_scaffold(globals.vcs, username);
        
        // Move shell to new home
        try {
            globals.vcs.cwd_set(homeDir);
        } catch { /* scaffolding ensures this exists */ }
        
        if (globals.terminal) globals.terminal.prompt_sync();
    }

    const btn: HTMLButtonElement | null = document.querySelector('.login-form button') as HTMLButtonElement;
    if (btn) {
        btn.textContent = 'ACCESS GRANTED';
        btn.classList.add('pulse');
    }

    setTimeout((): void => {
        stage_advanceTo('role-selection');

        if (btn) {
            btn.textContent = 'AUTHENTICATE';
            btn.classList.remove('pulse');
        }
    }, 1000);
}

/**
 * Logs the user out and resets the application state.
 * Clears form inputs, resets gutters, and navigates to login.
 */
export function user_logout(): void {
    store.project_unload();

    const loginUser: HTMLInputElement | null = document.getElementById('login-user') as HTMLInputElement;
    const loginPass: HTMLInputElement | null = document.getElementById('login-pass') as HTMLInputElement;
    if (loginUser) loginUser.value = '';
    if (loginPass) loginPass.value = '';

    const btn: HTMLButtonElement | null = document.querySelector('.login-form button') as HTMLButtonElement;
    if (btn) {
        btn.textContent = 'INITIATE SESSION';
        btn.classList.remove('pulse');
    }

    gutter_resetAll();
    gutter_setStatus(1, 'active');

    stage_advanceTo('login');
}

// ============================================================================
// Persona / Role
// ============================================================================

/**
 * Selects the user persona/role and initializes the workflow.
 *
 * @param persona - The selected persona.
 */
export function role_select(persona: Persona): void {
    persona_switch(persona);
    stage_advanceTo('search');
}

/**
 * Switches to a new persona. Updates persona buttons, the left-frame
 * persona display, and flashes the gutter.
 *
 * @param persona - The persona to switch to.
 */
export function persona_switch(persona: Persona): void {
    store.persona_set(persona);

    document.querySelectorAll('.persona-btn').forEach((btn: Element): void => {
        const btnPersona: string | null = btn.getAttribute('data-persona');
        btn.classList.toggle('active', btnPersona === persona);
    });

    const personaEl: HTMLElement | null = document.getElementById('current-persona');
    if (personaEl) {
        personaEl.textContent = persona.toUpperCase();
    }

    gutter_setStatus(1, 'active');
    setTimeout((): void => gutter_setStatus(1, 'success'), 300);
    setTimeout((): void => gutter_setStatus(1, 'idle'), 800);
}

/**
 * Initializes persona button click handlers on role-selection cards.
 */
export function personaButtons_initialize(): void {
    document.querySelectorAll('.persona-btn').forEach((btn: Element): void => {
        btn.addEventListener('click', (): void => {
            const persona: string | null = btn.getAttribute('data-persona');
            if (persona) {
                persona_switch(persona as Persona);
            }
        });
    });
}
