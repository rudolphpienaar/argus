/**
 * @file CLI Adapter for CalypsoCore
 *
 * Connects CalypsoCore to stdout/stdin for command-line usage.
 * Processes CalypsoResponse and renders output to the terminal.
 *
 * @module
 */

import type { CalypsoResponse, CalypsoAction } from '../types.js';

/**
 * ANSI color codes for terminal output.
 */
const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    blue: '\x1b[34m'
};

/**
 * Adapter that renders CalypsoResponse to CLI output.
 */
export class CLIAdapter {
    private verbose: boolean;

    constructor(options: { verbose?: boolean } = {}) {
        this.verbose = options.verbose ?? false;
    }

    /**
     * Process a CalypsoResponse and render to stdout.
     *
     * @param response - The response from CalypsoCore
     */
    public response_render(response: CalypsoResponse): void {
        // Render the message with styling
        const styled: string = this.message_style(response.message);
        console.log(styled);

        // In verbose mode, show actions
        if (this.verbose && response.actions.length > 0) {
            console.log(`${COLORS.dim}[Actions: ${response.actions.map(a => a.type).join(', ')}]${COLORS.reset}`);
        }
    }

    /**
     * Apply LCARS-style formatting to messages.
     */
    private message_style(message: string): string {
        return message
            // Affirmation markers
            .replace(/●/g, `${COLORS.green}●${COLORS.reset}`)
            // Data markers
            .replace(/○/g, `${COLORS.cyan}○${COLORS.reset}`)
            // Error markers
            .replace(/>>/g, `${COLORS.red}>>${COLORS.reset}`)
            // Dataset IDs
            .replace(/\[(ds-\d+)\]/g, `${COLORS.yellow}[$1]${COLORS.reset}`)
            // Paths
            .replace(/(~\/[^\s]+)/g, `${COLORS.blue}$1${COLORS.reset}`);
    }

    /**
     * Render the CALYPSO prompt.
     */
    public prompt_render(): string {
        return `${COLORS.cyan}CALYPSO>${COLORS.reset} `;
    }

    /**
     * Render a welcome banner.
     */
    public banner_render(): string {
        return `
${COLORS.cyan}╔══════════════════════════════════════════════════════════════╗
║  ${COLORS.bright}CALYPSO CORE V5.0.0${COLORS.reset}${COLORS.cyan}                                         ║
║  Cognitive Algorithms & Logic Yielding Predictive Scientific ║
║  Outcomes                                                    ║
╚══════════════════════════════════════════════════════════════╝${COLORS.reset}
`;
    }

    /**
     * Render a goodbye message.
     */
    public goodbye_render(): string {
        return `${COLORS.dim}Goodbye.${COLORS.reset}`;
    }

    /**
     * Render an error message.
     */
    public error_render(error: string): string {
        return `${COLORS.red}>> ERROR: ${error}${COLORS.reset}`;
    }

    /**
     * Render connection status.
     */
    public connectionStatus_render(host: string, port: number): string {
        return `${COLORS.dim}Connected to ${host}:${port}${COLORS.reset}\n`;
    }
}

/**
 * Singleton instance for convenience.
 */
export const cliAdapter: CLIAdapter = new CLIAdapter();
