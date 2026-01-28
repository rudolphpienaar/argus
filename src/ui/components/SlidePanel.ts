/**
 * @file Frame Slot - Slide Panel Primitive
 *
 * Manages the slide-in/slide-out animation for a content panel
 * within an LCARS frame slot. Uses CSS transitions (not keyframes)
 * so that animations can be interrupted by drag interactions.
 *
 * @module
 */

/**
 * Configuration for a SlidePanel instance.
 *
 * @property contentElement - The DOM element that will be animated.
 * @property slideDuration - Duration of the slide animation in ms (default: 400).
 * @property onSlideInComplete - Callback fired after slide-in completes.
 * @property onSlideOutComplete - Callback fired after slide-out completes.
 */
export interface SlidePanelOptions {
    contentElement: HTMLElement;
    slideDuration?: number;
    onSlideInComplete?: () => void;
    onSlideOutComplete?: () => void;
}

/**
 * Reusable slide animation primitive for content panels.
 *
 * Applies CSS class toggles to drive translateX transitions.
 * The managed element should have the `.frame-slot-panel` base class
 * (or equivalent transition rules) applied via CSS.
 *
 * @example
 * ```typescript
 * const panel = new SlidePanel({ contentElement: myElement });
 * panel.content_slideIn();
 * await panel.content_slideOut();
 * ```
 */
export class SlidePanel {
    private element: HTMLElement;
    private duration: number;
    private onSlideInComplete: (() => void) | null;
    private onSlideOutComplete: (() => void) | null;
    private activeClass: string;

    constructor(options: SlidePanelOptions) {
        this.element = options.contentElement;
        this.duration = options.slideDuration ?? 400;
        this.onSlideInComplete = options.onSlideInComplete ?? null;
        this.onSlideOutComplete = options.onSlideOutComplete ?? null;
        this.activeClass = 'slide-active';
    }

    /**
     * Slide content into view from the right.
     *
     * Adds the active class to trigger the CSS transition
     * from translateX(100%) to translateX(0).
     */
    public content_slideIn(): void {
        this.element.classList.remove('exiting');
        // Force reflow to restart transition if element was mid-exit
        void this.element.offsetWidth;
        this.element.classList.add(this.activeClass);

        if (this.onSlideInComplete) {
            this.element.addEventListener('transitionend', () => {
                this.onSlideInComplete?.();
            }, { once: true });
        }
    }

    /**
     * Slide content out of view to the right.
     *
     * Removes the active class and adds the exiting class.
     * Returns a Promise that resolves when the transition completes.
     *
     * @returns Promise that resolves when slide-out animation finishes.
     */
    public content_slideOut(): Promise<void> {
        return new Promise((resolve: () => void) => {
            this.element.classList.remove(this.activeClass);
            this.element.classList.add('exiting');

            const handler = (): void => {
                this.element.classList.remove('exiting');
                this.onSlideOutComplete?.();
                resolve();
            };

            this.element.addEventListener('transitionend', handler, { once: true });

            // Safety timeout in case transitionend does not fire
            setTimeout(handler, this.duration + 50);
        });
    }

    /**
     * Check whether the panel is currently slid into view.
     *
     * @returns true if the active class is present.
     */
    public state_isActive(): boolean {
        return this.element.classList.contains(this.activeClass);
    }
}
