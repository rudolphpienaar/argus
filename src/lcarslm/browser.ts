/**
 * @file Browser Calypso Runtime
 *
 * Creates and owns the browser-side CalypsoCore singleton so terminal
 * fallback commands use the same deterministic engine as CLI/server.
 *
 * @module
 */

import { CalypsoCore } from './CalypsoCore.js';
import type { CalypsoCoreConfig } from './types.js';
import { storeAdapter } from './adapters/StoreAdapter.js';
import { globals } from '../core/state/store.js';
import { SYSTEM_KNOWLEDGE } from '../core/data/knowledge.js';

let coreInstance: CalypsoCore | null = null;

/**
 * Get the browser CalypsoCore singleton.
 * Initializes lazily if needed.
 *
 * @returns CalypsoCore instance, or null if shell is not ready.
 */
export function core_get(): CalypsoCore | null {
    if (coreInstance) return coreInstance;
    return core_reinitialize();
}

/**
 * Rebuild CalypsoCore from current browser auth/runtime context.
 * Call this after auth/provider/simulation mode changes.
 *
 * @returns Reinitialized CalypsoCore instance, or null if shell is not ready.
 */
export function core_reinitialize(): CalypsoCore | null {
    if (!globals.shell) {
        coreInstance = null;
        return null;
    }

    const config: CalypsoCoreConfig = config_resolveFromBrowser();
    coreInstance = new CalypsoCore(globals.vcs, globals.shell, storeAdapter, config);
    return coreInstance;
}

/**
 * Resolve CalypsoCore config from browser localStorage.
 *
 * @returns Core config for current browser mode.
 */
function config_resolveFromBrowser(): CalypsoCoreConfig {
    const apiKey: string | null = storage_get('ARGUS_API_KEY');
    const provider: string | null = storage_get('ARGUS_PROVIDER');
    const model: string = storage_get('ARGUS_MODEL') || 'default';

    const hasLlmConfig: boolean = Boolean(apiKey && provider);

    if (hasLlmConfig && (provider === 'openai' || provider === 'gemini')) {
        return {
            simulationMode: false,
            llmConfig: {
                provider,
                apiKey: apiKey as string,
                model
            },
            knowledge: SYSTEM_KNOWLEDGE
        };
    }

    return {
        simulationMode: true,
        knowledge: SYSTEM_KNOWLEDGE
    };
}

/**
 * Safe browser storage getter.
 *
 * @param key - Storage key.
 * @returns Stored value or null.
 */
function storage_get(key: string): string | null {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
}

