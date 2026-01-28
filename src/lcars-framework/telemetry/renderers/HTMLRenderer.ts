/**
 * @file HTML Renderer
 * Simple renderer that sets the innerHTML of an element.
 */

import { TelemetryRenderer } from '../types.js';

export class HTMLRenderer implements TelemetryRenderer<string> {
    render(data: string, element: HTMLElement): void {
        element.innerHTML = data;
    }
}
