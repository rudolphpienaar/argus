/**
 * @file Gutter UI Controls
 * 
 * Manages the status indicators in the left gutter of the LCARS interface.
 * 
 * @module
 */

export type GutterStatus = 'idle' | 'active' | 'success' | 'error';

/**
 * Sets the status of a gutter section.
 *
 * @param section - The gutter section number (1-5)
 * @param status - The status to set
 */
export function gutter_setStatus(section: number, status: GutterStatus): void {
    const gutter = document.getElementById(`gutter-${section}`);
    if (gutter) {
        gutter.setAttribute('data-status', status);
    }
}

/**
 * Resets all gutter sections to idle.
 */
export function gutter_resetAll(): void {
    for (let i = 1; i <= 5; i++) {
        gutter_setStatus(i, 'idle');
    }
}
