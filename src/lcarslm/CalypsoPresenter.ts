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
    AFFIRMATIVE: chalk.cyan('●'),
    INFO: chalk.white('○'),
    ERROR: chalk.red('>> ERROR:'),
    WARNING: chalk.yellow('>> WARNING:'),
    HINT: chalk.magenta('»'),
};

/**
 * Presenter for formatting Calypso responses and artifacts.
 */
export class CalypsoPresenter {
    /**
     * Format a success message with the affirmative marker.
     */
    static success_format(message: string): string {
        return `${MARKERS.AFFIRMATIVE} ${message.toUpperCase()}`;
    }

    /**
     * Format an info message with the info marker.
     */
    static info_format(message: string): string {
        return `${MARKERS.INFO} ${message.toUpperCase()}`;
    }

    /**
     * Format an error message.
     */
    static error_format(message: string): string {
        return `${MARKERS.ERROR} ${message.toUpperCase()}`;
    }

    /**
     * Format a workflow transition warning.
     */
    static workflowWarning_format(transition: TransitionResult): string {
        let msg = `${MARKERS.WARNING} ${transition.warning?.toUpperCase() || 'WORKFLOW CONSTRAINT'}`;
        if (transition.reason) {
            msg += `\n${MARKERS.INFO} REASON: ${transition.reason.toUpperCase()}`;
        }
        if (transition.suggestion) {
            msg += `\n${MARKERS.HINT} SUGGESTION: ${transition.suggestion.toUpperCase()}`;
        }
        return msg;
    }

    /**
     * Format a list of datasets as a discovery listing.
     */
    static searchListing_format(results: Dataset[]): string {
        return results
            .map((ds: Dataset): string => `  [${ds.id}] ${ds.name} (${ds.modality}/${ds.annotationType})`)
            .join('\n');
    }

    /**
     * Format a detailed table of search results.
     */
    static searchTable_format(results: Dataset[]): string {
        if (results.length === 0) return '';

        const header = chalk.bold('  ID       MODALITY     ANATOMY      SAMPLES  PROVIDER');
        const separator = '  ' + '─'.repeat(header.length - 2);

        const rows = results.map(ds => {
            const id = ds.id.padEnd(8);
            const modality = ds.modality.padEnd(12);
            const type = ds.annotationType.padEnd(12);
            const images = String(ds.imageCount).padStart(7);
            const provider = ds.provider;
            return `  ${id} ${modality} ${type} ${images}  ${provider}`;
        });

        return `\n${header}\n${separator}\n${rows.join('\n')}`;
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
