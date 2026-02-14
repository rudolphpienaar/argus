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
import type { WorkflowSummary } from '../core/workflows/types.js';
import {
    COLORS,
    sleep_ms,
    spinner_start,
    spinnerLabel_resolve,
    spinnerMinDuration_resolve,
    scriptStepTelemetry_resolve,
    scriptStepPlan_resolve,
    harmonization_animate,
    response_renderAnimated,
    message_style,
    type CommandExecuteOptions,
    type ScriptStepPlan
} from '../calypso/ui/tui/TuiRenderer.js';

// ─── Configuration ─────────────────────────────────────────────────────────

const HOST: string = process.env.CALYPSO_HOST || 'localhost';
const PORT: number = parseInt(process.env.CALYPSO_PORT || '8081', 10);
const BASE_URL: string = `http://${HOST}:${PORT}`;

// COLORS, spinner, TUI rendering, animation — imported from calypso/ui/tui/TuiRenderer


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
 * Detect whether a script file uses structured format (has `steps:` key).
 */
function scriptIsStructured(content: string): boolean {
    return content.split(/\r?\n/).some((line: string): boolean => {
        const trimmed: string = line.trimStart();
        return trimmed === 'steps:' || trimmed.startsWith('steps:');
    });
}

/**
 * Parse legacy script content into plain command lines.
 */
function scriptCommands_parse(content: string): string[] {
    return content
        .split(/\r?\n/)
        .map((line: string): string => line.trim())
        .filter((line: string): boolean => line.length > 0 && !line.startsWith('#'));
}

/**
 * Execute a `.clpso` script (fail-fast).
 *
 * Legacy scripts (plain command lists) are executed client-side line by line.
 * Structured scripts are delegated to the server's ScriptRuntime via `/run`.
 */
async function script_run(
    scriptRef: string,
    commandExecute: (command: string, options?: CommandExecuteOptions) => Promise<boolean>
): Promise<boolean> {
    const resolvedPath: string | null = scriptPath_resolve(scriptRef);
    if (!resolvedPath) {
        // Not found locally — delegate entirely to server's built-in catalog
        console.log(`${COLORS.dim}○ Local script not found, trying built-in catalog on server...${COLORS.reset}`);
        return commandExecute(`/run ${scriptRef}`);
    }

    const content: string = fs.readFileSync(resolvedPath, 'utf-8');

    // Structured scripts → delegate to server's ScriptRuntime
    if (scriptIsStructured(content)) {
        console.log(`${COLORS.dim}○ Structured script detected, delegating to server...${COLORS.reset}`);
        return commandExecute(`/run ${scriptRef}`);
    }

    // Legacy scripts → simple command-by-command execution
    const commands: string[] = scriptCommands_parse(content);
    console.log(`${COLORS.cyan}● Running script:${COLORS.reset} ${COLORS.magenta}${resolvedPath}${COLORS.reset}`);

    if (commands.length === 0) {
        console.log(`${COLORS.yellow}○ Script has no executable commands: ${resolvedPath}${COLORS.reset}`);
        return true;
    }

    for (let i = 0; i < commands.length; i++) {
        const command: string = commands[i];
        console.log(`${COLORS.dim}[RUN ${i + 1}/${commands.length}] ${command}${COLORS.reset}`);
        const stepPlan: ScriptStepPlan = scriptStepPlan_resolve(command);
        console.log(`${COLORS.yellow}○ ${stepPlan.title}${COLORS.reset}`);
        console.log(`${COLORS.dim}○ ${scriptStepTelemetry_resolve(command)}${COLORS.reset}`);
        for (const line of stepPlan.lines) {
            console.log(`${COLORS.dim}   • ${line}${COLORS.reset}`);
            await sleep_ms(110 + Math.floor(Math.random() * 120));
        }
        const success: boolean = await commandExecute(command, {
            scriptStep: true,
            stepIndex: i + 1,
            stepTotal: commands.length
        });
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

// Output formatting (table_render, message_style, syntaxHighlight) — imported from calypso/ui/tui/

/**
 * Print the banner.
 */
function banner_print(): void {
    console.log(cliAdapter.banner_render());
    console.log(`${COLORS.dim}Connected to ${HOST}:${PORT}${COLORS.reset}`);
    console.log(`${COLORS.dim}Type "/help", "/scripts" to list automation flows, "/run <script>" to execute, "quit" to exit.${COLORS.reset}\n`);
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
        const allCommands = [...pathCommands, 'search', 'add', 'gather', 'mount', 'federate', 'pwd', 'env', 'whoami', 'help', '/scripts', '/run', 'quit'];
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
                try {
                    const standbyResponse: CalypsoResponse = await command_send(`/standby ${username}`);
                    if (standbyResponse.message) {
                        console.log(message_style(standbyResponse.message));
                    }
                } catch {
                    console.log(message_style(
                        `● Acknowledged, ${username}. Workflow guidance is in standby.\n` +
                        `○ Free exploration mode is active.\n` +
                        `○ Use \`/next\` for immediate command guidance or \`/workflow\` for stage status.`
                    ));
                }
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

    const command_executeAndRender = async (input: string, options: CommandExecuteOptions = {}): Promise<boolean> => {
        try {
            const spinnerLabel: string = spinnerLabel_resolve(input, options);
            const minSpinnerMs: number = spinnerMinDuration_resolve(input, options);
            const startedAt: number = Date.now();
            const stopSpinner: () => void = spinner_start(spinnerLabel);
            const response = await command_send(input);
            const elapsed: number = Date.now() - startedAt;
            if (elapsed < minSpinnerMs) {
                await sleep_ms(minSpinnerMs - elapsed);
            }
            stopSpinner();

            // Check for special animation markers
            if (response.message === '__HARMONIZE_ANIMATE__') {
                await harmonization_animate();
                console.log(message_style(`● **COHORT HARMONIZATION COMPLETE.** Data is now standardized for federated training.`));
            } else {
                await response_renderAnimated(response.message, input, options);
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
                console.log(`${COLORS.dim}Examples: /scripts, /run hist-harmonize${COLORS.reset}`);
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
