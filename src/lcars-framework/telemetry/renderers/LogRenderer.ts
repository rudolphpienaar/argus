/**
 * @file Log Renderer
 * Renders an array of strings as a scrolling log.
 */

import { TelemetryRenderer } from '../types.js';

export class LogRenderer implements TelemetryRenderer<string[]> {
    render(data: string[], element: HTMLElement): void {
        element.innerText = data.join('\n');
    }
}
