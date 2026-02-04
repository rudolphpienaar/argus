#!/usr/bin/env npx tsx
/**
 * @file Calypso CLI Client
 *
 * Interactive REPL for communicating with a Calypso server.
 * Can connect to either the headless server (make calypso) or
 * a running web app's WebSocket bridge.
 *
 * Usage:
 *   npx ts-node src/cli/calypso-cli.ts
 *   # or
 *   make calypso-cli
 *
 * @module
 * @see docs/calypso.adoc
 */

import * as readline from 'readline';
import http from 'http';
import type { CalypsoResponse, CalypsoAction } from '../lcarslm/types.js';
import { cliAdapter } from '../lcarslm/adapters/CLIAdapter.js';

// ─── Configuration ─────────────────────────────────────────────────────────

const HOST: string = process.env.CALYPSO_HOST || 'localhost';
const PORT: number = parseInt(process.env.CALYPSO_PORT || '8081', 10);
const BASE_URL: string = `http://${HOST}:${PORT}`;

// ─── ANSI Colors ───────────────────────────────────────────────────────────

// Dark background optimized colors (bright variants)
const COLORS = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',         // Bold
    italic: '\x1b[3m',         // Italic
    underline: '\x1b[4m',      // Underline
    dim: '\x1b[90m',           // Bright black (gray)
    cyan: '\x1b[96m',          // Bright cyan
    yellow: '\x1b[93m',        // Bright yellow
    red: '\x1b[91m',           // Bright red
    green: '\x1b[92m',         // Bright green
    blue: '\x1b[94m',          // Bright blue
    magenta: '\x1b[95m',       // Bright magenta
    white: '\x1b[97m',         // Bright white
    hideCursor: '\x1b[?25l',
    showCursor: '\x1b[?25h'
};

// ─── Spinner ────────────────────────────────────────────────────────────────

const SPINNER_FRAMES: readonly string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Starts a thinking spinner on the current line.
 * Returns a stop function that clears the spinner.
 */
function spinner_start(label: string = 'CALYPSO thinking'): () => void {
    let frameIdx: number = 0;
    process.stdout.write(COLORS.hideCursor);

    const timer: NodeJS.Timeout = setInterval((): void => {
        const frame: string = SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length];
        process.stdout.write(`\r${COLORS.cyan}${frame}${COLORS.reset} ${COLORS.dim}${label}...${COLORS.reset}  `);
        frameIdx++;
    }, 80);

    return (): void => {
        clearInterval(timer);
        // Clear the spinner line and reset cursor
        process.stdout.write(`\r${' '.repeat(label.length + 10)}\r`);
        process.stdout.write(COLORS.showCursor);
    };
}

// ─── HTTP Client ───────────────────────────────────────────────────────────

/**
 * Send a command to the Calypso server.
 */
async function command_send(command: string): Promise<CalypsoResponse> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({ command });

        const options: http.RequestOptions = {
            hostname: HOST,
            port: PORT,
            path: '/calypso/command',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body) as CalypsoResponse;
                    resolve(response);
                } catch (e: unknown) {
                    reject(new Error(`Invalid response: ${body}`));
                }
            });
        });

        req.on('error', (e) => {
            reject(new Error(`Connection failed: ${e.message}`));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Fetch current prompt from server and apply colors.
 */
async function prompt_fetch(): Promise<string> {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: HOST,
            port: PORT,
            path: '/calypso/prompt',
            method: 'GET'
        }, (res: http.IncomingMessage): void => {
            let body = '';
            res.on('data', (chunk: Buffer | string): void => { body += chunk; });
            res.on('end', (): void => {
                try {
                    const data = JSON.parse(body) as { prompt: string };
                    // Parse prompt parts: user@CALYPSO:[path]>
                    const match: RegExpMatchArray | null = data.prompt.match(/^([^@]+)@([^:]+):\[([^\]]+)\]>\s*$/);
                    if (match) {
                        const [, user, host, path] = match;
                        resolve(`${COLORS.green}${user}${COLORS.reset}@${COLORS.cyan}${host}${COLORS.reset}:[${COLORS.magenta}${path}${COLORS.reset}]> `);
                    } else {
                        // Fallback: return raw prompt with basic styling
                        resolve(`${COLORS.cyan}${data.prompt}${COLORS.reset}`);
                    }
                } catch {
                    resolve(`${COLORS.yellow}CALYPSO>${COLORS.reset} `);
                }
            });
        });
        req.on('error', (): void => resolve(`${COLORS.yellow}CALYPSO>${COLORS.reset} `));
        req.end();
    });
}

/**
 * Send login request to server with username.
 */
async function login_send(username: string): Promise<boolean> {
    return new Promise((resolve) => {
        const postData = JSON.stringify({ username });
        const req = http.request({
            hostname: HOST,
            port: PORT,
            path: '/calypso/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res: http.IncomingMessage): void => {
            resolve(res.statusCode === 200);
        });
        req.on('error', (): void => resolve(false));
        req.write(postData);
        req.end();
    });
}

/**
 * Check if server is running.
 */
async function server_ping(): Promise<boolean> {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: HOST,
            port: PORT,
            path: '/calypso/version',
            method: 'GET'
        }, (res: http.IncomingMessage): void => {
            resolve(res.statusCode === 200);
        });

        req.on('error', (): void => resolve(false));
        req.end();
    });
}

// ─── Output Formatting ─────────────────────────────────────────────────────

/**
 * Render a markdown table as formatted terminal output.
 */
function table_render(tableText: string): string {
    const lines = tableText.trim().split('\n');
    if (lines.length < 2) return tableText;

    // Parse rows into cells
    const rows: string[][] = [];
    for (const line of lines) {
        // Skip separator lines (| :--- | --- |)
        if (/^\|[\s:-]+\|$/.test(line.replace(/\|/g, '|').trim())) continue;

        const cells = line.split('|')
            .slice(1, -1)  // Remove empty first/last from | split
            .map((cell: string): string => cell.trim().replace(/\*\*/g, '')); // Remove bold markers
        if (cells.length > 0) {
            rows.push(cells);
        }
    }

    if (rows.length === 0) return tableText;

    // Calculate column widths
    const colWidths: number[] = [];
    for (const row of rows) {
        row.forEach((cell: string, i: number): void => {
            colWidths[i] = Math.max(colWidths[i] || 0, cell.length);
        });
    }

    // Build output with box drawing
    const hLine = '─';
    const topBorder: string = `┌${colWidths.map((w: number): string => hLine.repeat(w + 2)).join('┬')}┐`;
    const midBorder: string = `├${colWidths.map((w: number): string => hLine.repeat(w + 2)).join('┼')}┤`;
    const botBorder: string = `└${colWidths.map((w: number): string => hLine.repeat(w + 2)).join('┴')}┘`;

    const output: string[] = [topBorder];

    rows.forEach((row: string[], rowIdx: number): void => {
        const paddedCells: string[] = row.map((cell: string, i: number): string => ` ${cell.padEnd(colWidths[i])} `);
        const rowLine = `│${paddedCells.join('│')}│`;

        if (rowIdx === 0) {
            // Header row - colorize
            output.push(`${COLORS.yellow}${rowLine}${COLORS.reset}`);
            output.push(midBorder);
        } else {
            output.push(rowLine);
        }
    });

    output.push(botBorder);
    return output.join('\n');
}

/**
 * Style a message for terminal output (dark background optimized).
 */
function message_style(message: string): string {
    // Check for markdown tables and render them
    const tableRegex = /(\|[^\n]+\|\n)+/g;
    message = message.replace(tableRegex, (match) => {
        // Only process if it looks like a proper table (has separator row)
        if (match.includes('---')) {
            return table_render(match);
        }
        return match;
    });

    return message
        // Convert HTML spans to ANSI colors
        .replace(/<span class="dir">(.*?)<\/span>/g, `${COLORS.cyan}$1${COLORS.reset}`)
        .replace(/<span class="file">(.*?)<\/span>/g, `${COLORS.white}$1${COLORS.reset}`)
        .replace(/<span class="exec">(.*?)<\/span>/g, `${COLORS.green}$1${COLORS.reset}`)
        .replace(/<span class="dim">(.*?)<\/span>/g, `${COLORS.dim}$1${COLORS.reset}`)
        .replace(/<span class="highlight">(.*?)<\/span>/g, `${COLORS.yellow}$1${COLORS.reset}`)
        .replace(/<span class="success">(.*?)<\/span>/g, `${COLORS.green}$1${COLORS.reset}`)
        .replace(/<span class="error">(.*?)<\/span>/g, `${COLORS.red}$1${COLORS.reset}`)
        // Strip any remaining HTML tags
        .replace(/<[^>]+>/g, '')
        // Markdown bold (**text**) → bright white bold (must precede italic)
        .replace(/\*\*([^*]+)\*\*/g, `${COLORS.bright}${COLORS.white}$1${COLORS.reset}`)
        // Markdown italic (*text*) → italic
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, `${COLORS.italic}$1${COLORS.reset}`)
        // Markdown inline code (`text`) → yellow
        .replace(/`([^`]+)`/g, `${COLORS.yellow}$1${COLORS.reset}`)
        // Markdown headers (### text) → bold cyan
        .replace(/^(#{1,4})\s+(.+)$/gm, `${COLORS.bright}${COLORS.cyan}$2${COLORS.reset}`)
        // Affirmation markers (bright green bullet)
        .replace(/●/g, `${COLORS.green}●${COLORS.reset}`)
        // Data markers (bright cyan circle)
        .replace(/○/g, `${COLORS.cyan}○${COLORS.reset}`)
        // Error markers (bright red)
        .replace(/>>/g, `${COLORS.red}>>${COLORS.reset}`)
        // Dataset IDs (bright yellow)
        .replace(/\[(ds-\d+)\]/g, `${COLORS.yellow}[$1]${COLORS.reset}`)
        // Paths (bright magenta for visibility)
        .replace(/(~\/[^\s]+)/g, `${COLORS.magenta}$1${COLORS.reset}`)
        .replace(/(\/home\/[^\s]+)/g, `${COLORS.magenta}$1${COLORS.reset}`);
}

/**
 * Print the banner.
 */
function banner_print(): void {
    console.log(cliAdapter.banner_render());
    console.log(`${COLORS.dim}Connected to ${HOST}:${PORT}${COLORS.reset}`);
    console.log(`${COLORS.dim}Type "/help" for commands, "quit" to exit.${COLORS.reset}\n`);
}

// ─── Tab Completion ─────────────────────────────────────────────────────────

/**
 * Fetch directory listing from server for tab completion.
 */
function dir_list(path: string): Promise<string[]> {
    return new Promise((resolve) => {
        const encodedPath = encodeURIComponent(path);
        const req = http.request({
            hostname: HOST,
            port: PORT,
            path: `/calypso/command`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, (res: http.IncomingMessage): void => {
            let body: string = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    // Parse ls output - extract names from the HTML/text
                    const names: string[] = [];
                    const lines = response.message.split('\n');
                    for (const line of lines) {
                        // Extract filename from "name/   " or "name   " pattern
                        const match = line.match(/^(?:<[^>]+>)?([^\s<]+)/);
                        if (match && match[1]) {
                            names.push(match[1].replace(/<[^>]+>/g, ''));
                        }
                    }
                    resolve(names);
                } catch {
                    resolve([]);
                }
            });
        });
        req.on('error', () => resolve([]));
        req.write(JSON.stringify({ command: `ls ${path}` }));
        req.end();
    });
}

/**
 * Tab completion handler.
 */
async function completer(line: string): Promise<[string[], string]> {
    const words = line.split(/\s+/);
    const lastWord = words[words.length - 1] || '';

    // Commands that take paths
    const pathCommands = ['ls', 'cd', 'cat', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'tree'];
    const cmd = words[0]?.toLowerCase();

    // Complete commands if first word
    if (words.length === 1 && !line.endsWith(' ')) {
        const allCommands = [...pathCommands, 'search', 'add', 'gather', 'mount', 'federate', 'pwd', 'env', 'whoami', 'help', 'quit'];
        const matches: string[] = allCommands.filter((c: string): boolean => c.startsWith(lastWord));
        return [matches, lastWord];
    }

    // Complete paths for path commands
    if (pathCommands.includes(cmd) || lastWord.startsWith('/') || lastWord.startsWith('~') || lastWord.startsWith('.')) {
        // Determine directory to list and prefix to match
        let dirPath = '.';
        let prefix = lastWord;

        if (lastWord.includes('/')) {
            const lastSlash = lastWord.lastIndexOf('/');
            dirPath = lastWord.substring(0, lastSlash) || '/';
            prefix = lastWord.substring(lastSlash + 1);
        } else if (lastWord === '~') {
            dirPath = '~';
            prefix = '';
        }

        const entries: string[] = await dir_list(dirPath);
        const matches: string[] = entries
            .filter((name: string): boolean => name.startsWith(prefix))
            .map((name: string): string => {
                const base: string = lastWord.includes('/')
                    ? lastWord.substring(0, lastWord.lastIndexOf('/') + 1)
                    : (dirPath === '.' ? '' : dirPath + '/');
                return base + name;
            });

        return [matches, lastWord];
    }

    // Complete dataset IDs for add/remove
    if (cmd === 'add' || cmd === 'remove') {
        const dsIds: string[] = ['ds-001', 'ds-002', 'ds-003', 'ds-004', 'ds-005', 'ds-006'];
        const matches: string[] = dsIds.filter((id: string): boolean => id.startsWith(lastWord));
        return [matches, lastWord];
    }

    return [[], lastWord];
}

// ─── REPL ──────────────────────────────────────────────────────────────────

/**
 * Prompt user for login credentials (SSH-style).
 */
async function login_prompt(): Promise<string> {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log(`${COLORS.cyan}╔════════════════════════════════════════════════════════════════╗${COLORS.reset}`);
        console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.bright}CALYPSO TERMINAL ACCESS${COLORS.reset}                                       ${COLORS.cyan}║${COLORS.reset}`);
        console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.dim}Secure connection to ARGUS Federation Network${COLORS.reset}                 ${COLORS.cyan}║${COLORS.reset}`);
        console.log(`${COLORS.cyan}╚════════════════════════════════════════════════════════════════╝${COLORS.reset}`);
        console.log();

        rl.question(`${COLORS.yellow}login as:${COLORS.reset} `, (answer: string) => {
            rl.close();
            const username: string = answer.trim() || 'developer';
            resolve(username);
        });
    });
}

/**
 * Main REPL loop.
 */
async function repl_start(): Promise<void> {
    // Check server connectivity
    const isRunning = await server_ping();
    if (!isRunning) {
        console.error(`${COLORS.red}>> ERROR: Cannot connect to Calypso server at ${BASE_URL}`);
        console.error(`${COLORS.dim}   Make sure the server is running: make calypso${COLORS.reset}`);
        process.exit(1);
    }

    // Login prompt (SSH-style)
    const username: string = await login_prompt();

    // Send login to server to initialize with username
    const loginSuccess: boolean = await login_send(username);
    if (!loginSuccess) {
        console.error(`${COLORS.red}>> Login failed${COLORS.reset}`);
        process.exit(1);
    }

    console.log(`${COLORS.dim}Authenticating ${username}...${COLORS.reset}`);
    console.log(`${COLORS.green}● Access granted.${COLORS.reset}`);
    console.log();

    banner_print();

    // Fetch personalized greeting from LLM
    try {
        const stopGreetSpinner: () => void = spinner_start('CALYPSO initializing');
        const greetingResponse = await command_send(`/greet ${username}`);
        stopGreetSpinner();
        if (greetingResponse.message) {
            console.log(message_style(greetingResponse.message));
            console.log();
        }
    } catch {
        // Greeting is optional - continue if it fails
    }

    // Fetch initial prompt from server
    let currentPrompt: string = await prompt_fetch();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: currentPrompt,
        completer: (line: string, callback: (err: Error | null, result: [string[], string]) => void) => {
            completer(line).then(result => callback(null, result)).catch(() => callback(null, [[], line]));
        }
    });

    rl.prompt();

    rl.on('line', async (line: string) => {
        const input = line.trim();

        // Handle exit commands
        if (input === 'quit' || input === 'exit' || input === 'q') {
            console.log(`${COLORS.dim}Goodbye.${COLORS.reset}`);
            rl.close();
            process.exit(0);
        }

        // Skip empty input
        if (!input) {
            rl.prompt();
            return;
        }

        try {
            const stopSpinner: () => void = spinner_start();
            const response = await command_send(input);
            stopSpinner();

            const styled = message_style(response.message);
            console.log(styled);

            // Show actions in verbose mode (can be toggled with env var)
            if (process.env.CALYPSO_VERBOSE === 'true' && response.actions.length > 0) {
                const actionTypes: string = response.actions.map((a: CalypsoAction): string => a.type).join(', ');
                console.log(`${COLORS.dim}[Actions: ${actionTypes}]${COLORS.reset}`);
            }

            // Update prompt (pwd may have changed)
            currentPrompt = await prompt_fetch();
            rl.setPrompt(currentPrompt);
        } catch (e: unknown) {
            const error = e instanceof Error ? e.message : 'Unknown error';
            console.log(`${COLORS.red}>> ERROR: ${error}${COLORS.reset}`);
        }

        rl.prompt();
    });

    rl.on('close', () => {
        console.log(`\n${COLORS.dim}Goodbye.${COLORS.reset}`);
        process.exit(0);
    });
}

// ─── Main ──────────────────────────────────────────────────────────────────

repl_start().catch((e) => {
    console.error(`${COLORS.red}Fatal error: ${e.message}${COLORS.reset}`);
    process.exit(1);
});
