/**
 * @file Gather Overlay Transition Helpers
 *
 * Shared transition mechanics for Gather-stage overlay surfaces.
 *
 * Responsibilities:
 * - Reveal overlay after optional terminal frame collapse.
 * - Hide overlay with standardized closing animation lifecycle.
 *
 * Non-responsibilities:
 * - Overlay content composition.
 * - VFS/store mutations and stage navigation.
 *
 * @module core/stages/gather/ui/overlay
 */

/**
 * Minimal frame-slot contract needed for Gather overlay transitions.
 */
export interface GatherFrameSlot {
    state_isOpen(): boolean;
    frame_open(): void;
    frame_close(): Promise<void>;
}

/**
 * Reveal an overlay, first collapsing terminal frame when open.
 */
export function overlay_revealAfterTerminalCollapse(
    overlay: HTMLElement,
    frameSlot: GatherFrameSlot | null | undefined,
): void {
    if (frameSlot && frameSlot.state_isOpen()) {
        frameSlot.frame_close().then((): void => {
            overlay.classList.remove('hidden', 'closing');
        });
        return;
    }
    overlay.classList.remove('hidden', 'closing');
}

/**
 * Hide an overlay with closing animation, then run completion callback.
 */
export function overlay_closeAnimated(
    overlay: HTMLElement,
    onHidden: () => void,
): void {
    overlay.classList.add('closing');
    overlay.addEventListener('animationend', (): void => {
        overlay.classList.add('hidden');
        overlay.classList.remove('closing');
        onHidden();
    }, { once: true });
}
