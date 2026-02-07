/**
 * @file Command Logic
 *
 * Browser terminal fallback router.
 * Delegates all non-shell commands to CalypsoCore so browser and CLI
 * share a single deterministic workflow authority.
 *
 * @module
 */

import { globals } from '../state/store.js';
import type { CalypsoResponse } from '../../lcarslm/types.js';
import { core_get } from '../../lcarslm/browser.js';
import { browserAdapter } from '../../lcarslm/adapters/BrowserAdapter.js';

/**
 * Handles fallback commands typed into the browser terminal.
 * Non-shell input is executed through CalypsoCore and mapped to
 * browser-side actions by BrowserAdapter.
 *
 * @param cmd - The base command string.
 * @param args - The command arguments.
 */
export async function command_dispatch(cmd: string, args: string[]): Promise<void> {
    const t = globals.terminal;
    if (!t) return;

    const core = core_get();
    if (!core) {
        t.println('<span class="error">>> ERROR: CALYPSO CORE NOT INITIALIZED.</span>');
        return;
    }

    const input: string = [cmd, ...args].join(' ').trim();
    const response: CalypsoResponse = await core.command_execute(input);

    browserAdapter.response_apply(response);

    if (response.message === '__HARMONIZE_ANIMATE__') {
        t.println('● COHORT HARMONIZATION COMPLETE. DATA STANDARDIZED FOR FEDERATION.');
        return;
    }

    if (response.message) {
        response.message.split('\n').forEach((line: string): void => t.println(line));
    }
}
