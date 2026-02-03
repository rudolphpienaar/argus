/**
 * @file Typewriter Animation Utility
 * 
 * Renders text character-by-character to simulate a retro terminal interface.
 * Inspired by the "MU/TH/UR" 6000 interface from Alien (1979).
 * 
 * @module
 */

export class Typewriter {
    private element: HTMLElement;
    private speed: number;

    /**
     * Creates a new Typewriter instance.
     * @param element - The target DOM element to type into.
     * @param speed - Typing speed in milliseconds per character (default: 30ms).
     */
    constructor(element: HTMLElement, speed: number = 30) {
        this.element = element;
        this.speed = speed;
    }

    /**
     * Types the given text into the element.
     * Appends to existing content.
     * 
     * @param text - The text to type.
     * @returns Promise that resolves when typing is complete.
     */
    public type(text: string): Promise<void> {
        return new Promise((resolve) => {
            let i = 0;
            this.element.classList.add('muthur-cursor');
            
            const typeChar = () => {
                if (i < text.length) {
                    this.element.textContent += text.charAt(i);
                    i++;
                    
                    // Keep visible
                    this.element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                    
                    // Randomize speed slightly for mechanical feel
                    const variance = Math.random() * 20 - 10;
                    setTimeout(typeChar, this.speed + variance);
                } else {
                    this.element.classList.remove('muthur-cursor');
                    resolve();
                }
            };

            typeChar();
        });
    }

    /**
     * Removes text character-by-character from the element.
     * 
     * @returns Promise that resolves when backspacing is complete.
     */
    public backspace(): Promise<void> {
        return new Promise((resolve) => {
            this.element.classList.add('muthur-cursor');
            
            const deleteChar = () => {
                const currentText = this.element.textContent || '';
                if (currentText.length > 0) {
                    this.element.textContent = currentText.substring(0, currentText.length - 1);
                    
                    const variance = Math.random() * 10 - 5;
                    setTimeout(deleteChar, (this.speed / 2) + variance); // Backspacing is usually faster
                } else {
                    this.element.classList.remove('muthur-cursor');
                    resolve();
                }
            };

            deleteChar();
        });
    }
}
