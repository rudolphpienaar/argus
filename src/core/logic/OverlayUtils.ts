/**
 * @file Overlay Utilities
 * Shared helpers for managing the multi-mode asset detail overlay.
 * @module
 */

/**
 * Clears the overlay slot containers (sidebar, content, command).
 * The marketplace's original DOM is never touched — mode switching
 * is handled entirely by CSS via the data-mode attribute.
 */
export function overlaySlots_clear(): void {
    const sidebarSlot: HTMLElement | null = document.getElementById('overlay-sidebar-slot');
    const contentSlot: HTMLElement | null = document.getElementById('overlay-content-slot');
    const commandSlot: HTMLElement | null = document.getElementById('overlay-command-slot');
    if (sidebarSlot) sidebarSlot.innerHTML = '';
    if (contentSlot) contentSlot.innerHTML = '';
    if (commandSlot) commandSlot.innerHTML = '';
}
