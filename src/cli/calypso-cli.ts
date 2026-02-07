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
import fs from 'fs';
import path from 'path';
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

// ─── Harmonization Animation ───────────────────────────────────────────────

/**
 * Runs an animated harmonization sequence in the terminal.
 * Creates a btop-style progress display with fake metrics.
 */
async function harmonization_animate(): Promise<void> {
    const WIDTH: number = 64;
    const BAR_WIDTH: number = 24;
    const METRIC_WIDTH: number = 28;

    const boxRow_render = (content: string): string => {
        const visibleLength: number = Array.from(stripAnsi(content)).length;
        const paddingLength: number = Math.max(0, WIDTH - visibleLength);
        return `${COLORS.cyan}║${COLORS.reset}${content}${' '.repeat(paddingLength)}${COLORS.cyan}║${COLORS.reset}`;
    };

    const boxRow_print = (content: string = ''): void => {
        console.log(boxRow_render(content));
    };

    const boxRule_print = (left: '╔' | '╠' | '╚', right: '╗' | '╣' | '╝'): void => {
        console.log(`${COLORS.cyan}${left}${'═'.repeat(WIDTH)}${right}${COLORS.reset}`);
    };

    const text_fit = (text: string, width: number): string => {
        const chars: string[] = Array.from(text);
        if (chars.length <= width) return text.padEnd(width);
        if (width <= 1) return chars.slice(0, width).join('');
        return `${chars.slice(0, width - 1).join('')}…`;
    };

    // Analysis phases with fake metrics
    const phases: Array<{ name: string; metrics: string[] }> = [
        {
            name: 'DICOM Header Analysis',
            metrics: ['Patient ID normalization', 'Study date validation', 'Modality tag verification']
        },
        {
            name: 'Image Geometry Check',
            metrics: ['Pixel spacing validation', 'Slice thickness analysis', 'Orientation matrix check']
        },
        {
            name: 'Intensity Normalization',
            metrics: ['Histogram equalization', 'Window/level standardization', 'Bit depth conversion']
        },
        {
            name: 'Metadata Reconciliation',
            metrics: ['Institution code mapping', 'Series description cleanup', 'Annotation format sync']
        },
        {
            name: 'Quality Metrics Generation',
            metrics: ['SNR calculation', 'Artifact detection', 'Coverage completeness']
        }
    ];

    process.stdout.write(COLORS.hideCursor);

    // Draw header box
    console.log();
    boxRule_print('╔', '╗');
    boxRow_print(`  ${COLORS.bright}${COLORS.yellow}CALYPSO HARMONIZATION ENGINE${COLORS.reset}`);
    boxRow_print(`  ${COLORS.dim}Standardizing cohort for federated learning${COLORS.reset}`);
    boxRule_print('╠', '╣');

    // Process each phase
    for (let phaseIdx = 0; phaseIdx < phases.length; phaseIdx++) {
        const phase = phases[phaseIdx];

        // Phase header
        boxRow_print();
        boxRow_print(`  ${COLORS.green}▶${COLORS.reset} ${COLORS.bright}${phase.name}${COLORS.reset}`);

        // Animate progress bar
        for (let progress = 0; progress <= 100; progress += 5) {
            const filled: number = Math.floor((progress / 100) * BAR_WIDTH);
            const empty: number = BAR_WIDTH - filled;
            const bar: string = `${COLORS.green}${'█'.repeat(filled)}${COLORS.dim}${'░'.repeat(empty)}${COLORS.reset}`;

            // Pick a metric to display based on progress
            const metricIdx: number = Math.min(Math.floor((progress / 100) * phase.metrics.length), phase.metrics.length - 1);
            const metric: string = phase.metrics[metricIdx];
            const metricPadded: string = text_fit(metric, METRIC_WIDTH);

            const progressLine: string = `  [${bar}] ${COLORS.yellow}${progress.toString().padStart(3)}%${COLORS.reset} ${COLORS.dim}${metricPadded}${COLORS.reset}`;
            process.stdout.write(`\r${boxRow_render(progressLine)}`);

            await sleep_ms(30 + Math.random() * 40);
        }
        console.log(); // Move to next line after progress complete
    }

    // Summary stats
    boxRow_print();
    boxRule_print('╠', '╣');
    boxRow_print(`  ${COLORS.bright}HARMONIZATION SUMMARY${COLORS.reset}`);
    boxRow_print();

    // Fake stats with typewriter effect
    const stats: string[] = [
        `  ${COLORS.green}✓${COLORS.reset} Images processed:     ${COLORS.yellow}1,247${COLORS.reset}`,
        `  ${COLORS.green}✓${COLORS.reset} Metadata fields:      ${COLORS.yellow}18,705${COLORS.reset}`,
        `  ${COLORS.green}✓${COLORS.reset} Format conversions:   ${COLORS.yellow}312${COLORS.reset}`,
        `  ${COLORS.green}✓${COLORS.reset} Quality score:        ${COLORS.yellow}94.7%${COLORS.reset}`,
        `  ${COLORS.green}✓${COLORS.reset} Federation ready:     ${COLORS.green}YES${COLORS.reset}`
    ];

    for (const stat of stats) {
        boxRow_print(stat);
        await sleep_ms(100);
    }

    boxRow_print();
    boxRule_print('╚', '╝');
    console.log();

    process.stdout.write(COLORS.showCursor);
}

/**
 * Sleep for specified milliseconds.
 */
function sleep_ms(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip ANSI codes from string for length calculation.
 */
function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Extract an executable command from a possibly pasted transcript line.
 *
 * Supported:
 * - Raw commands: `search histology`
 * - Prompt-prefixed commands: `user@CALYPSO:[~/x]> search histology`
 *
 * Returns `null` for known non-command transcript output lines so users can
 * paste whole conversations without replaying response text as commands.
 */
function transcriptCommand_extract(line: string): string | null {
    const trimmed: string = line.trim();
    if (!trimmed) return '';

    const promptMatch: RegExpMatchArray | null =
        trimmed.match(/^[^@\n]+@CALYPSO:\[[^\]]*\]>\s*(.+)$/i) ||
        trimmed.match(/^CALYPSO>\s*(.+)$/i);

    if (promptMatch) {
        return promptMatch[1].trim();
    }

    const isTranscriptOutput: boolean = /^(●|○|>>|╔|╠|╚|║|├|└|═|─|\[LOCAL EXECUTION:|--- TRAINING LOG ---|Epoch \d+\/\d+|Model weights saved to:|Validation metrics saved to:)/.test(trimmed);
    if (isTranscriptOutput) {
        return null;
    }

    return trimmed;
}

/**
 * Resolve a .clpso script path from user input.
 *
 * Lookup order:
 * 1) Direct path as provided (relative to cwd or absolute)
 * 2) Same with `.clpso` extension appended
 * 3) `scripts/calypso/<name>` in repo cwd
 * 4) `scripts/calypso/<name>.clpso` in repo cwd
 *
 * @param scriptRef - User-provided script reference.
 * @returns Absolute file path if found, else null.
 */
function scriptPath_resolve(scriptRef: string): string | null {
    const trimmedRef: string = scriptRef.trim();
    if (!trimmedRef) return null;

    const withExtension: string = trimmedRef.endsWith('.clpso') ? trimmedRef : `${trimmedRef}.clpso`;
    const candidates: string[] = [
        path.resolve(process.cwd(), trimmedRef),
        path.resolve(process.cwd(), withExtension),
        path.resolve(process.cwd(), 'scripts', 'calypso', trimmedRef),
        path.resolve(process.cwd(), 'scripts', 'calypso', withExtension)
    ];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        const stat: fs.Stats = fs.statSync(candidate);
        if (stat.isFile()) {
            return candidate;
        }
    }

    return null;
}

/**
 * Parse script file content into executable commands.
 * Ignores empty lines and `#` comments.
 *
 * @param content - Raw script content.
 * @returns Ordered list of commands to execute.
 */
function scriptCommands_parse(content: string): string[] {
    return content
        .split(/\r?\n/)
        .map((line: string): string => line.trim())
        .filter((line: string): boolean => line.length > 0 && !line.startsWith('#'));
}

/**
 * Execute a `.clpso` script line-by-line (fail-fast).
 *
 * @param scriptRef - Script path or short name.
 * @param commandExecute - Command executor callback.
 * @returns True if script fully succeeded; false on first failure.
 */
async function script_run(
    scriptRef: string,
    commandExecute: (command: string) => Promise<boolean>
): Promise<boolean> {
    const resolvedPath: string | null = scriptPath_resolve(scriptRef);
    if (!resolvedPath) {
        console.log(`${COLORS.red}>> ERROR: Script not found: ${scriptRef}${COLORS.reset}`);
        console.log(`${COLORS.dim}   Tried direct path and scripts/calypso/*.clpso${COLORS.reset}`);
        return false;
    }

    const content: string = fs.readFileSync(resolvedPath, 'utf-8');
    const commands: string[] = scriptCommands_parse(content);

    if (commands.length === 0) {
        console.log(`${COLORS.yellow}○ Script has no executable commands: ${resolvedPath}${COLORS.reset}`);
        return true;
    }

    console.log(`${COLORS.cyan}● Running script:${COLORS.reset} ${COLORS.magenta}${resolvedPath}${COLORS.reset}`);

    for (let i = 0; i < commands.length; i++) {
        const command: string = commands[i];
        console.log(`${COLORS.dim}[RUN ${i + 1}/${commands.length}] ${command}${COLORS.reset}`);
        const success: boolean = await commandExecute(command);
        if (!success) {
            console.log(`${COLORS.red}>> Script aborted at step ${i + 1}.${COLORS.reset}`);
            return false;
        }
    }

    console.log(`${COLORS.green}● Script complete.${COLORS.reset}`);
    return true;
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

/** Workflow summary from server */
interface WorkflowSummary {
    id: string;
    name: string;
    persona: string;
    description: string;
    stageCount: number;
}

/** Login response from server */
interface LoginResponse {
    success: boolean;
    username: string;
    workflows: WorkflowSummary[];
}

/**
 * Send login request to server with username.
 *
 * @param username - The username to login with
 * @returns Login response with available workflows
 */
async function login_send(username: string): Promise<LoginResponse> {
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
            let body: string = '';
            res.on('data', (chunk: Buffer): void => { body += chunk.toString(); });
            res.on('end', (): void => {
                try {
                    const data = JSON.parse(body);
                    resolve({
                        success: res.statusCode === 200,
                        username: data.username || username,
                        workflows: data.workflows || []
                    });
                } catch {
                    resolve({ success: false, username, workflows: [] });
                }
            });
        });
        req.on('error', (): void => resolve({ success: false, username, workflows: [] }));
        req.write(postData);
        req.end();
    });
}

/**
 * Send persona/workflow selection to server.
 *
 * @param workflowId - The workflow ID to set (or 'skip' for none)
 * @returns True if successful
 */
async function persona_send(workflowId: string): Promise<boolean> {
    return new Promise((resolve) => {
        const postData = JSON.stringify({ workflowId });
        const req = http.request({
            hostname: HOST,
            port: PORT,
            path: '/calypso/persona',
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
 * Prompt user to select a persona/workflow (conversational style).
 *
 * Called after Calypso greets the user, so she asks about workflow preference.
 *
 * @param workflows - Available workflows from server
 * @param rl - Existing readline interface to reuse
 * @returns Selected workflow ID or 'skip'
 */
async function persona_prompt(workflows: WorkflowSummary[], rl: readline.Interface): Promise<string> {
    return new Promise((resolve) => {
        // Calypso asks about workflow preference
        console.log();
        console.log(message_style(`I can guide you through a **structured workflow** if you'd like. Here are the available paths:`));
        console.log();

        // Display available workflows conversationally
        workflows.forEach((wf: WorkflowSummary, idx: number): void => {
            console.log(`  ${COLORS.cyan}${idx + 1}.${COLORS.reset} ${COLORS.bright}${wf.name}${COLORS.reset}`);
            console.log(`     ${COLORS.dim}${wf.description} (${wf.stageCount} steps)${COLORS.reset}`);
        });
        console.log(`  ${COLORS.cyan}${workflows.length + 1}.${COLORS.reset} ${COLORS.dim}No guidance needed - I'll explore freely${COLORS.reset}`);
        console.log();

        // Pause the main REPL and ask
        rl.pause();
        rl.question(`${COLORS.yellow}Which workflow would you like to follow? [1-${workflows.length + 1}]:${COLORS.reset} `, (answer: string) => {
            const choice: number = parseInt(answer.trim(), 10);

            if (isNaN(choice) || choice < 1 || choice > workflows.length + 1) {
                // Default to first workflow
                resolve(workflows[0]?.id || 'skip');
            } else if (choice === workflows.length + 1) {
                resolve('skip');
            } else {
                resolve(workflows[choice - 1].id);
            }
            rl.resume();
        });
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
    console.log(`${COLORS.dim}Type "/help" for commands, "/run <script>" for automation, "quit" to exit.${COLORS.reset}\n`);
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
        const allCommands = [...pathCommands, 'search', 'add', 'gather', 'mount', 'federate', 'pwd', 'env', 'whoami', 'help', '/run', 'quit'];
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
    const loginResponse: LoginResponse = await login_send(username);
    if (!loginResponse.success) {
        console.error(`${COLORS.red}>> Login failed${COLORS.reset}`);
        process.exit(1);
    }

    console.log(`${COLORS.dim}Authenticating ${loginResponse.username}...${COLORS.reset}`);
    console.log(`${COLORS.green}● Access granted.${COLORS.reset}`);
    console.log();

    banner_print();

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

    // Fetch personalized greeting from LLM
    try {
        const stopGreetSpinner: () => void = spinner_start('CALYPSO initializing');
        const greetingResponse = await command_send(`/greet ${username}`);
        stopGreetSpinner();
        if (greetingResponse.message) {
            console.log(message_style(greetingResponse.message));
        }
    } catch {
        // Greeting is optional - continue if it fails
    }

    // Calypso asks about workflow preference (after greeting)
    if (loginResponse.workflows.length > 0) {
        const selectedWorkflowId: string = await persona_prompt(loginResponse.workflows, rl);

        // Send selection to server
        const personaSuccess: boolean = await persona_send(selectedWorkflowId);
        if (personaSuccess) {
            console.log();
            if (selectedWorkflowId === 'skip') {
                console.log(message_style(`No problem! I'm here whenever you need guidance. Just ask.`));
            } else {
                const selected: WorkflowSummary | undefined = loginResponse.workflows.find(
                    (w: WorkflowSummary): boolean => w.id === selectedWorkflowId
                );
                console.log(message_style(`**${selected?.name || selectedWorkflowId}** activated. I'll guide you through each step.`));
            }
        }
    }
    console.log();

    rl.prompt();

    const command_executeAndRender = async (input: string): Promise<boolean> => {
        try {
            const stopSpinner: () => void = spinner_start();
            const response = await command_send(input);
            stopSpinner();

            // Check for special animation markers
            if (response.message === '__HARMONIZE_ANIMATE__') {
                await harmonization_animate();
                console.log(message_style(`● **COHORT HARMONIZATION COMPLETE.** Data is now standardized for federated training.`));
            } else {
                const styled = message_style(response.message);
                console.log(styled);
            }

            // Show actions in verbose mode (can be toggled with env var)
            if (process.env.CALYPSO_VERBOSE === 'true' && response.actions.length > 0) {
                const actionTypes: string = response.actions.map((a: CalypsoAction): string => a.type).join(', ');
                console.log(`${COLORS.dim}[Actions: ${actionTypes}]${COLORS.reset}`);
            }

            // Update prompt (pwd may have changed)
            currentPrompt = await prompt_fetch();
            rl.setPrompt(currentPrompt);
            return response.success;
        } catch (e: unknown) {
            const error = e instanceof Error ? e.message : 'Unknown error';
            console.log(`${COLORS.red}>> ERROR: ${error}${COLORS.reset}`);
            return false;
        }
    };

    rl.on('line', async (line: string) => {
        const extracted: string | null = transcriptCommand_extract(line);

        // Ignore known transcript output lines to support conversation paste replay.
        if (extracted === null) {
            rl.prompt();
            return;
        }

        const input: string = extracted.trim();

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

        if (input === '/run' || input.startsWith('/run ')) {
            const scriptRef: string = input.replace(/^\/run\s*/, '').trim();
            if (!scriptRef) {
                console.log(`${COLORS.yellow}Usage: /run <script.clpso>${COLORS.reset}`);
                console.log(`${COLORS.dim}Example: /run harmonize${COLORS.reset}`);
            } else {
                await script_run(scriptRef, command_executeAndRender);
            }
            rl.prompt();
            return;
        }

        await command_executeAndRender(input);
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
