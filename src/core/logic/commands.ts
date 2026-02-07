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
 * Sleep helper for terminal animation pacing.
 */
function sleep_ms(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Render a response message with optional line-stream pacing.
 */
async function message_renderAnimated(message: string): Promise<void> {
    const t = globals.terminal;
    if (!t) return;

    const trainingMode: boolean = message.includes('--- TRAINING LOG ---');
    const federationMode: boolean =
        message.includes('PHASE 1/3 COMPLETE: BUILD ARTIFACTS') ||
        message.includes('PHASE 2/3: MARKETPLACE PUBLISH PREPARATION') ||
        message.includes('PHASE 2/3 COMPLETE: MARKETPLACE PUBLISHING') ||
        message.includes('PHASE 3/3: FEDERATION DISPATCH & COMPUTE') ||
        message.includes('FEDERATED COMPUTE ROUNDS') ||
        message.includes('[1/5] SOURCE CODE TRANSCOMPILE') ||
        message.includes('[2/5] CONTAINER COMPILATION') ||
        message.includes('[3/5] MARKETPLACE PUBLISHING COMPLETE');
    const lines: string[] = message.split('\n');

    if (!trainingMode && !federationMode) {
        lines.forEach((line: string): void => t.println(line));
        return;
    }

    for (const line of lines) {
        t.println(line);

        if (!line.trim()) {
            await sleep_ms(60 + Math.floor(Math.random() * 50));
            continue;
        }

        if (trainingMode) {
            if (/^Epoch \d+\/\d+/i.test(line)) {
                await sleep_ms(260 + Math.floor(Math.random() * 220));
            } else {
                await sleep_ms(120 + Math.floor(Math.random() * 120));
            }
            continue;
        }

        // federation mode
        if (/ROUND\s+\d+\/\d+/i.test(line)) {
            await sleep_ms(580 + Math.floor(Math.random() * 520));
        } else if (line.includes('DISPATCHED')) {
            await sleep_ms(440 + Math.floor(Math.random() * 420));
        } else if (/^\s*○\s+\[\d\/5\]/.test(line)) {
            await sleep_ms(520 + Math.floor(Math.random() * 420));
        } else {
            await sleep_ms(220 + Math.floor(Math.random() * 260));
        }
    }
}

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
        await message_renderAnimated(response.message);
    }
}
