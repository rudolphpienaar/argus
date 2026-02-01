/**
 * @file Resize Handle Interaction
 * Reusable logic for drag-to-resize handles in split-pane layouts.
 * @module
 */

export interface ResizeOptions {
    /** The element to be resized. */
    target: HTMLElement;
    /** The handle element that triggers the resize. */
    handle: HTMLElement;
    /** Minimum height/width in pixels. Default: 100. */
    minSize?: number;
    /** Direction of resize. Default: 'vertical'. */
    direction?: 'vertical' | 'horizontal';
    /** Optional callback when resize occurs. */
    onResize?: (newSize: number) => void;
}

/**
 * Attaches drag-to-resize listeners to a handle element.
 * Returns a cleanup function that removes all listeners.
 *
 * @param options - Configuration for the resize behavior.
 * @returns Cleanup function.
 */
export function resizeHandle_attach(options: ResizeOptions): () => void {
    const { target, handle, minSize = 100, direction = 'vertical' } = options;

    let isDragging: boolean = false;
    let startCoord: number = 0;
    let startSize: number = 0;

    const onMouseDown = (e: MouseEvent): void => {
        isDragging = true;
        if (direction === 'vertical') {
            startCoord = e.clientY;
            startSize = target.offsetHeight;
            document.body.style.cursor = 'ns-resize';
        } else {
            startCoord = e.clientX;
            startSize = target.offsetWidth;
            document.body.style.cursor = 'ew-resize';
        }

        handle.classList.add('active');
        // Disable transitions during drag for responsiveness
        target.style.transition = 'none';
        e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent): void => {
        if (!isDragging) return;

        const currentCoord: number = direction === 'vertical' ? e.clientY : e.clientX;
        const delta: number = currentCoord - startCoord;
        const newSize: number = Math.max(minSize, startSize + delta);

        if (direction === 'vertical') {
            target.style.height = `${newSize}px`;
        } else {
            target.style.width = `${newSize}px`;
        }

        if (options.onResize) {
            options.onResize(newSize);
        }
    };

    const onMouseUp = (): void => {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
        // Restore transitions (caller might need to handle this if they want specific behavior)
        target.style.transition = '';
    };

    handle.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return (): void => {
        handle.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };
}
