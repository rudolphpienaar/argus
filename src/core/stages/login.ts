/**
 * @file Login and Persona Logic
 * 
 * Manages user authentication, session state, and persona switching.
 * 
 * @module
 */

import { state, store } from '../state/store.js';
import { gutter_setStatus, gutter_resetAll } from '../../ui/gutters.js';
import { stage_advanceTo } from '../logic/navigation.js';

type Persona = 'developer' | 'annotator' | 'user' | 'provider' | 'scientist' | 'clinician' | 'admin' | 'fda';

/**
 * Authenticates the user (mock).
 */
export function user_authenticate(): void {
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
        // Navigation call
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
export function user_logout(): void {
    // Use store action
    store.unloadProject();

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
export function role_select(persona: Persona): void {
    // Set persona
    persona_switch(persona);
    
    // Advance to Search
    stage_advanceTo('search');
}

/**
 * Switches to a new persona.
 *
 * @param persona - The persona to switch to
 */
export function persona_switch(persona: Persona): void {
    store.setPersona(persona);

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
export function personaButtons_initialize(): void {
    document.querySelectorAll('.persona-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const persona = btn.getAttribute('data-persona') as Persona;
            if (persona) {
                persona_switch(persona);
            }
        });
    });
}
