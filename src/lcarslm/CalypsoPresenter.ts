/**
 * @file Calypso Presenter
 *
 * Handles the visual language and formatting of Calypso responses.
 * Encapsulates ANSI decorators, Star Trek LCARS markers, and complex
 * table/list builders.
 *
 * @module lcarslm/presenter
 */

import chalk from 'chalk';
import type { Dataset } from '../core/models/types.js';
import type { TransitionResult } from '../dag/bridge/WorkflowAdapter.js';

/**
 * Standard markers for Calypso's visual dialect.
 */
export const MARKERS = {
    AFFIRMATIVE: '●',
    INFO: '○',
    ERROR: '>> ERROR:',
    WARNING: '>> WARNING:',
    HINT: '»',
};

/**
 * Detects if the current execution context is a web browser.
 */
function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Presenter for formatting Calypso responses and artifacts.
 */
export class CalypsoPresenter {
    /**
     * Format a success message with the affirmative marker.
     */
    static success_format(message: string): string {
        const text: string = `${MARKERS.AFFIRMATIVE} ${message.toUpperCase()}`;
        return this.wrap_muthur(text, 'success');
    }

    /**
     * Format an info message with the info marker.
     */
    static info_format(message: string): string {
        const text: string = `${MARKERS.INFO} ${message.toUpperCase()}`;
        return this.wrap_muthur(text, 'info');
    }

    /**
     * Format an error message.
     */
    static error_format(message: string): string {
        const text: string = `${MARKERS.ERROR} ${message.toUpperCase()}`;
        return this.wrap_muthur(text, 'error');
    }

    /**
     * Format a workflow transition warning.
     */
    static workflowWarning_format(transition: TransitionResult): string {
        let msg: string = `${MARKERS.WARNING} ${transition.warning?.toUpperCase() || 'WORKFLOW CONSTRAINT'}`;
        if (transition.reason) {
            msg += `\n${MARKERS.INFO} REASON: ${transition.reason.toUpperCase()}`;
        }
        if (transition.suggestion) {
            msg += `\n${MARKERS.HINT} SUGGESTION: ${transition.suggestion.toUpperCase()}`;
        }
        return this.wrap_muthur(msg, 'warning');
    }

    /**
     * Wraps text in an environment-aware container.
     * In Browser: HTML span with LCARS classes.
     * In Headless: ANSI colored text (or plain text).
     */
    private static wrap_muthur(text: string, type: 'success' | 'info' | 'error' | 'warning'): string {
        if (!isBrowser()) {
            // Headless: Apply ANSI colors via chalk
            switch (type) {
                case 'success': return chalk.cyan(text);
                case 'error':   return chalk.red(text);
                case 'warning': return chalk.yellow(text);
                case 'info':    return chalk.white(text);
                default:        return text;
            }
        }

        // Browser: Wrap in LCARS-compatible spans
        const baseClass: string = 'muthur-text';
        let typeClass: string = '';
        switch (type) {
            case 'success': typeClass = ' success'; break; // success usually maps to sky/honey
            case 'error':   typeClass = ' error'; break;
            case 'warning': typeClass = ' warn'; break;
            case 'info':    typeClass = ' dim'; break;
        }
        
        return `<span class="${baseClass}${typeClass}">${text}</span>`;
    }

    /**
     * Format a list of datasets as a discovery listing.
     */
    static searchListing_format(results: Dataset[]): string {
        const list: string = results
            .map((ds: Dataset): string => `  [${ds.id}] ${ds.name} (${ds.modality}/${ds.annotationType})`)
            .join('\n');
        return this.wrap_muthur(list, 'info');
    }

    /**
     * Format a detailed table of search results.
     */
    static searchTable_format(results: Dataset[]): string {
        if (results.length === 0) return '';

        const header: string = '  ID       MODALITY     ANATOMY      SAMPLES  PROVIDER';
        const separator: string = '  ' + '─'.repeat(header.length - 2);

        const rows: string[] = results.map((ds: Dataset): string => {
            const id: string = ds.id.padEnd(8);
            const modality: string = ds.modality.padEnd(12);
            const type: string = ds.annotationType.padEnd(12);
            const images: string = String(ds.imageCount).padStart(7);
            const provider: string = ds.provider;
            return `  ${id} ${modality} ${type} ${images}  ${provider}`;
        });

        const table: string = `\n${header}\n${separator}\n${rows.join('\n')}`;
        return isBrowser() ? `<pre class="lcars-table">${table}</pre>` : chalk.bold(table);
    }

    /**
     * Format a progress bar for terminal or web.
     *
     * @param label - Task label (e.g. "SCANNING")
     * @param percent - Completion percentage (0-100)
     * @param duration - Animation duration in seconds (browser only)
     */
    static progressBar_format(label: string, percent: number, duration: number = 2): string {
        const cleanLabel: string = label.toUpperCase();
        
        if (!isBrowser()) {
            // Headless: ASCII Bar [#####-----] 50%
            const width: number = 20;
            const filled: number = Math.round((percent / 100) * width);
            const empty: number = width - filled;
            const bar: string = `[${'#'.repeat(filled)}${'-'.repeat(empty)}]`;
            return `${cleanLabel.padEnd(15)} ${chalk.cyan(bar)} ${percent}%`;
        }

        // Browser: CSS-Animated Progress Bar
        // We use a unique ID for the animation if needed, but standard class is fine
        return `
<div class="lcars-progress-block">
    <div class="progress-label">${cleanLabel}</div>
    <div class="progress-track">
        <div class="progress-fill" style="width: ${percent}%; animation: lcars-progress-grow ${duration}s ease-out forwards;"></div>
    </div>
    <div class="progress-percent">${percent}%</div>
</div>`.trim();
    }

    /**
     * Format full dataset details as a markdown table for terminal/web rendering.
     */
    static searchDetails_format(results: Dataset[]): string {
        return results.map((ds: Dataset, index: number): string => {
            const safeName: string = this.markdownCell_normalize(ds.name);
            const safeProvider: string = this.markdownCell_normalize(ds.provider);
            const safeDescription: string = this.markdownCell_normalize(ds.description);
            const lines: string[] = [
                `### DATASET ${index + 1}/${results.length}`,
                '| Field | Value |',
                '|---|---|',
                `| ID | ${ds.id} |`,
                `| Name | ${safeName} |`,
                `| Modality | ${ds.modality} |`,
                `| Annotation | ${ds.annotationType} |`,
                `| Images | ${ds.imageCount.toLocaleString()} |`,
                `| Size | ${ds.size} |`,
                `| Cost | $${ds.cost.toFixed(2)} |`,
                `| Provider | ${safeProvider} |`,
                `| Description | ${safeDescription} |`
            ];
            return lines.join('\n');
        }).join('\n\n');
    }

    /**
     * Normalize text for markdown table cell rendering.
     */
    private static markdownCell_normalize(value: string): string {
        return value
            .replace(/\|/g, '/')
            .replace(/\r?\n/g, ' ')
            .trim();
    }
}
