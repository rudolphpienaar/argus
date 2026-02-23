import { describe, it, expect } from 'vitest';
import { message_style, ansi_strip } from './TuiRenderer.js';

describe('TuiRenderer conversational wrapping', (): void => {
    it('wraps plain conversational prose when width hint is set', (): void => {
        const raw: string = 'This sentence should wrap into multiple lines for easier terminal reading.';
        const styled: string = message_style(raw, { conversationalWidth: 50 });
        const plain: string = ansi_strip(styled);
        const lines: string[] = plain.split('\n');

        expect(lines.length).toBeGreaterThan(1);
        expect(lines.every((line: string): boolean => line.length <= 50)).toBe(true);
    });

    it('preserves structured list lines without forced wrapping', (): void => {
        const raw: string = 'Here is a summary:\n- first item should stay list-shaped and readable';
        const styled: string = message_style(raw, { conversationalWidth: 20 });
        const plain: string = ansi_strip(styled);
        const lines: string[] = plain.split('\n');

        expect(lines.some((line: string): boolean => line.startsWith('- '))).toBe(true);
    });
});
