/**
 * @file Frame Slot Orchestrator
 *
 * Coordinates the two-phase "double whammy" animation pattern:
 *   Open:  Phase 1 (frame expands) -> Phase 2 (content slides in from right)
 *   Close: Simultaneous (content slides out + frame collapses in parallel)
 *
 * See docs/visual_language.adoc for the full specification.
 *
 * @module
 */

import { SlidePanel } from './SlidePanel.js';

/**
 * Configuration for a FrameSlot instance.
 *
 * @property frameElement - The container element that expands/collapses (the slot).
 * @property openClass - CSS class toggled on the frame to trigger expansion (default: 'open').
 * @property frameDuration - Duration of the frame height transition in ms (default: 600).
 * @property contentElement - The DOM element inside the frame that slides in/out.
 * @property slideDuration - Duration of the content slide animation in ms (default: 400).
 * @property openHeight - Target height when the frame is open (default: '600px').
 */
export interface FrameSlotOptions {
    frameElement: HTMLElement;
    openClass?: string;
    frameDuration?: number;
    contentElement: HTMLElement;
    slideDuration?: number;
    openHeight?: string;
    onOpen?: () => void;
    onClose?: () => void;
}

/**
 * Orchestrates the Frame-then-Slide animation pattern.
 *
 * On open: frame expands vertically, then content slides in from the right.
 * On close: content slides out and frame collapses simultaneously.
 *
 * @example
 * ```typescript
 * const slot = new FrameSlot({
 *     frameElement: document.getElementById('intelligence-console')!,
 *     contentElement: wrapper,
 * });
 * await slot.frame_open();
 * await slot.frame_close();
 * ```
 */
export class FrameSlot {
    private frameEl: HTMLElement;
    private openClass: string;
    private frameDuration: number;
    private openHeight: string;
    private slidePanel: SlidePanel;
    private _isOpen: boolean = false;
    private _isAnimating: boolean = false;
    private onOpen: (() => void) | null;
    private onClose: (() => void) | null;

    constructor(options: FrameSlotOptions) {
        this.frameEl = options.frameElement;
        this.openClass = options.openClass ?? 'open';
        this.frameDuration = options.frameDuration ?? 600;
        this.openHeight = options.openHeight ?? '600px';
        this.onOpen = options.onOpen ?? null;
        this.onClose = options.onClose ?? null;

        this.slidePanel = new SlidePanel({
            contentElement: options.contentElement,
            slideDuration: options.slideDuration ?? 400,
        });
    }

    /**
     * Whether the frame slot is currently open.
     */
    public state_isOpen(): boolean {
        return this._isOpen;
    }

    /**
     * Open the frame slot with two-phase animation.
     *
     * Phase 1: Frame container expands (height transition).
     * Phase 2: Content panel slides in from the right.
     */
    public async frame_open(): Promise<void> {
        if (this._isOpen || this._isAnimating) return;
        this._isAnimating = true;

        // Phase 1: Expand the frame
        this.frameEl.classList.add(this.openClass);
        if (!this.frameEl.style.height) {
            this.frameEl.style.height = this.openHeight;
        }

        await this.frameTransition_wait();

        // Phase 2: Slide content in
        this.slidePanel.content_slideIn();

        this._isOpen = true;
        this._isAnimating = false;
        this.onOpen?.();
    }

    /**
     * Close the frame slot with overlapped animation.
     *
     * Content slides out AND frame collapses simultaneously
     * for a snappier dismiss (~600ms total instead of ~1000ms sequential).
     */
    public async frame_close(): Promise<void> {
        if (!this._isOpen || this._isAnimating) return;
        this._isAnimating = true;

        // Allow overflow during close so slide-out is visible while height collapses
        this.frameEl.classList.add('frame-closing');

        // Simultaneous: slide out content AND collapse frame together
        const slideOutPromise: Promise<void> = this.slidePanel.content_slideOut();

        this.frameEl.classList.remove(this.openClass);
        this.frameEl.style.height = '';

        // Wait for the longer of the two (frame collapse at 600ms dominates)
        await Promise.all([
            slideOutPromise,
            this.frameTransition_wait(),
        ]);

        this.frameEl.classList.remove('frame-closing');
        this._isOpen = false;
        this._isAnimating = false;
        this.onClose?.();
    }

    /**
     * Toggle the frame slot open or closed.
     */
    public async frame_toggle(): Promise<void> {
        if (this._isOpen) {
            await this.frame_close();
        } else {
            await this.frame_open();
        }
    }

    /**
     * Synchronize the slide panel state after external manipulation
     * (e.g., the draggable access strip changing the frame height directly).
     *
     * If the frame is open but the slide panel is not active, triggers slide-in.
     * If the frame is closed, ensures the slide panel is reset.
     */
    public state_syncAfterDrag(): void {
        const isFrameOpen: boolean = this.frameEl.classList.contains(this.openClass);
        const isSlideActive: boolean = this.slidePanel.state_isActive();

        if (isFrameOpen && !isSlideActive) {
            this.slidePanel.content_slideIn();
            this._isOpen = true;
        } else if (!isFrameOpen) {
            this._isOpen = false;
        }
    }

    /**
     * Wait for the frame element's CSS height transition to complete.
     *
     * Includes a safety timeout in case transitionend does not fire
     * (e.g., when the element is not visible or the transition is skipped).
     */
    private frameTransition_wait(): Promise<void> {
        return new Promise((resolve: () => void) => {
            let resolved: boolean = false;

            const handler = (): void => {
                if (resolved) return;
                resolved = true;
                this.frameEl.removeEventListener('transitionend', handler);
                resolve();
            };

            this.frameEl.addEventListener('transitionend', handler, { once: true });

            // Safety timeout: frameDuration + 50ms buffer
            setTimeout(handler, this.frameDuration + 50);
        });
    }
}
