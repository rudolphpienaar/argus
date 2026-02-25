/**
 * @file Search Stage AI/Auth Facade
 *
 * Owns Search-stage authentication and AI-runtime bootstrapping concerns.
 *
 * Responsibilities:
 * - Read/write persisted AI credentials from browser storage.
 * - Materialize or clear the `LCARSEngine` runtime singleton.
 * - Toggle Search-stage auth/query/status panels based on readiness.
 * - Re-synchronize Browser Calypso runtime whenever auth state changes.
 *
 * This module intentionally does not render dataset cards, mutate project
 * topology, or manage gather store.state. It is a strict auth/runtime boundary.
 *
 * @module core/stages/search/controllers/auth
 */

import { store } from '../../../state/store.js';
import { LCARSEngine } from '../../../../lcarslm/kernel/LCARSEngine.js';
import { core_reinitialize } from '../../../../lcarslm/browser.js';
import { SYSTEM_KNOWLEDGE } from '../../../data/knowledge.js';

/**
 * Initializes the LCARS engine from persisted credentials.
 */
export function lcarslm_initialize(): void {
    const apiKey: string | null = localStorage.getItem('ARGUS_API_KEY');
    const provider: string | null = localStorage.getItem('ARGUS_PROVIDER');
    const model: string = localStorage.getItem('ARGUS_MODEL') || 'default';

    if (apiKey && provider) {
        store.globalLcarsEngine_set(new LCARSEngine(
            {
                apiKey,
                model,
                provider: provider as 'openai' | 'gemini',
            },
            SYSTEM_KNOWLEDGE
        ));
        searchUiPanels_setState('ready');
        if (store.globals.terminal) {
            store.globals.terminal.setStatus(`MODE: [${provider.toUpperCase()}] // MODEL: [${model.toUpperCase()}]`);
            store.globals.terminal.println(`>> AI CORE LINK ESTABLISHED: PROVIDER [${provider.toUpperCase()}]`);
        }
    } else {
        searchUiPanels_setState('auth-required');
    }

    core_reinitialize();
}

/**
 * Persists auth form fields and initializes the LCARS engine.
 */
export function lcarslm_auth(): void {
    const input: HTMLInputElement = document.getElementById('api-key-input') as HTMLInputElement;
    const modelInput: HTMLInputElement = document.getElementById('api-model-input') as HTMLInputElement;
    const providerSelect: HTMLSelectElement = document.getElementById('api-provider-select') as HTMLSelectElement;

    const key: string = input.value.trim();
    const provider: string = providerSelect.value;
    const model: string = modelInput.value.trim() || 'default';

    if (key.length <= 5) {
        alert('Invalid Key Format.');
        return;
    }

    localStorage.setItem('ARGUS_API_KEY', key);
    localStorage.setItem('ARGUS_PROVIDER', provider);
    localStorage.setItem('ARGUS_MODEL', model);
    lcarslm_initialize();
}

/**
 * Clears persisted auth state and disables AI mode.
 */
export function lcarslm_reset(): void {
    localStorage.removeItem('ARGUS_API_KEY');
    localStorage.removeItem('ARGUS_PROVIDER');
    localStorage.removeItem('ARGUS_OPENAI_KEY');
    store.globalLcarsEngine_set(null);
    searchUiPanels_setState('auth-required');
    core_reinitialize();
}

/**
 * Enables simulation mode without provider credentials.
 */
export function lcarslm_simulate(): void {
    store.globalLcarsEngine_set(new LCARSEngine(null, SYSTEM_KNOWLEDGE));
    searchUiPanels_setState('ready');
    core_reinitialize();
    if (store.globals.terminal) {
        store.globals.terminal.setStatus('MODE: [SIMULATION] // EMULATION ACTIVE');
        store.globals.shell?.command_execute('/greet');
    }
}

/**
 * Toggle Search-stage panel visibility by auth/runtime store.state.
 */
function searchUiPanels_setState(status: 'auth-required' | 'ready'): void {
    const authPanel: HTMLElement | null = document.getElementById('search-auth-panel');
    const queryPanel: HTMLElement | null = document.getElementById('search-query-panel');
    const statusPanel: HTMLElement | null = document.getElementById('search-status-panel');

    if (!authPanel || !queryPanel) {
        return;
    }

    if (status === 'ready') {
        authPanel.style.display = 'none';
        queryPanel.style.display = 'block';
        if (statusPanel) {
            statusPanel.style.display = 'block';
        }
        return;
    }

    authPanel.style.display = 'block';
    queryPanel.style.display = 'none';
    if (statusPanel) {
        statusPanel.style.display = 'none';
    }
}
