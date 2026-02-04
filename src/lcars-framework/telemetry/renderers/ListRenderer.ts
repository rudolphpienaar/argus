/**
 * @file List Renderer
 * Renders an array of items using a template function.
 */

import { TelemetryRenderer } from '../types.js';

export class ListRenderer<T> implements TelemetryRenderer<T[]> {
    constructor(
        private headerHtml: string,
        private itemFormatter: (item: T) => string
    ) {}

    render(data: T[], element: HTMLElement): void {
        let html: string = `<span class="dim">${this.headerHtml}</span>\n`;
        data.forEach((item: T): void => {
            html += this.itemFormatter(item) + '\n';
        });
        element.innerHTML = html;
    }
}
