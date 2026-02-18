/**
 * @file Command Logic
 *
 * Browser terminal fallback router.
 * Delegates all non-shell commands to CalypsoCore so browser and CLI
 * share a single deterministic workflow authority.
 *
 * @module
 */

import { store } from '../state/store.js';
import type { CalypsoResponse } from '../../lcarslm/types.js';
import { core_get } from '../../lcarslm/browser.js';
import { browserAdapter } from '../../lcarslm/adapters/BrowserAdapter.js';
import { syntax_highlight } from '../../ui/syntaxHighlight.js';
import { language_fromCatCommand, filename_forLanguage } from '../syntax/languageRegistry.js';

/**
 * Sleep helper for terminal animation pacing.
 */
function sleep_ms(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Render terminal message with syntax-highlighted code/fenced blocks.
 */
function message_style(message: string, input: string): string {
    const blocks: Map<string, string> = new Map<string, string>();
    let blockIdx: number = 0;
    const block_stash = (rendered: string): string => {
        const key: string = `__WEB_CODE_BLOCK_${blockIdx++}__`;
        blocks.set(key, rendered);
        return key;
    };

    // Render fenced code blocks first and stash them to avoid line-level transforms.
    let styled: string = message.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_all: string, rawLang: string, code: string): string => {
        const language: string = rawLang?.trim().toLowerCase() || 'text';
        const fileName: string = filename_forLanguage(language);
        const highlighted: string = syntax_highlight(code, fileName);
        const label: string = `<span class="dim">[${language.toUpperCase()}]</span>`;
        return block_stash(`${label}\n${highlighted}`);
    });

    // For direct `cat <file>` output (plain source), highlight whole payload.
    const catLanguage: string | null = language_fromCatCommand(input);
    if (catLanguage && blocks.size === 0) {
        const looksStructuredResponse: boolean = /(^\s*[●○>>]|<span class=|^\s*POWER SCRIPTS AVAILABLE|^\s*CALYPSO GUIDANCE)/m.test(styled);
        if (!looksStructuredResponse) {
            styled = syntax_highlight(styled, filename_forLanguage(catLanguage));
        }
    }

    for (const [key, value] of blocks.entries()) {
        styled = styled.replaceAll(key, value);
    }
    return styled;
}

/**
 * Render a response message with optional line-stream pacing.
 */
async function message_renderAnimated(message: string, input: string): Promise<void> {
    const t = store.globals.terminal;
    if (!t) return;

    const trainingMode: boolean = message.includes('--- TRAINING LOG ---');
    const scriptMode: boolean = message.includes('RUNNING SCRIPT:') && /\[(OK|ERR)\]\s+\[\d+\/\d+\]/.test(message);
    const federationMode: boolean =
        /STEP\s+[1-5]\/5/.test(message) ||
        message.includes('PHASE 1/3 COMPLETE: BUILD ARTIFACTS') ||
        message.includes('PHASE 2/3: MARKETPLACE PUBLISH PREPARATION') ||
        message.includes('PHASE 2/3 COMPLETE: MARKETPLACE PUBLISHING') ||
        message.includes('PHASE 3/3: FEDERATION DISPATCH & COMPUTE') ||
        message.includes('FEDERATED COMPUTE ROUNDS') ||
        message.includes('[1/5] SOURCE CODE TRANSCOMPILE') ||
        message.includes('[2/5] CONTAINER COMPILATION') ||
        message.includes('[3/5] MARKETPLACE PUBLISHING COMPLETE');
    const lines: string[] = message.split('\n');

    if (!trainingMode && !scriptMode && !federationMode) {
        // Preserve fenced blocks/newlines and apply syntax rendering as one payload.
        t.println(message_style(message, input));
        return;
    }

    for (const line of lines) {
        t.println(message_style(line, input));

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

        if (scriptMode) {
            if (/\[(OK|ERR)\]\s+\[\d+\/\d+\]/.test(line)) {
                await sleep_ms(560 + Math.floor(Math.random() * 380));
            } else if (/^\s*->/.test(line)) {
                await sleep_ms(220 + Math.floor(Math.random() * 180));
            } else {
                await sleep_ms(150 + Math.floor(Math.random() * 150));
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
    const t = store.globals.terminal;
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
        await message_renderAnimated(response.message, input);
    }
}
