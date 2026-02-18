/**
 * @file Process Terminal Controls
 *
 * Terminal/frame toggles scoped to Process-stage UX.
 *
 * @module core/stages/process/terminal
 */

import { store } from '../../state/store.js';

/**
 * Toggle the intelligence console frame.
 */
export function terminal_toggle(): void {
    store.globals.frameSlot?.frame_toggle();
}
