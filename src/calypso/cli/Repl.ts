/**
 * @file Calypso CLI REPL
 *
 * Interactive readline REPL that communicates with CalypsoServer via
 * WebSocket (CalypsoClient) and renders output via TuiRenderer.
 *
 * @module
 */

import * as readline from 'readline';
import fs from 'fs';
import path from 'path';
import type { CalypsoAction } from '../../lcarslm/types.js';
import type { WorkflowSummary } from '../../core/workflows/types.js';
import { cliAdapter } from '../../lcarslm/adapters/CLIAdapter.js';
import { CalypsoClient } from '../client/CalypsoClient.js';
import {
    COLORS,
    sleep_ms,
    spinner_start,
    spinnerLabel_resolve,
    spinnerMinDuration_resolve,
    rendererFrame_open,
    rendererFrame_close,
    rendererPhase_start,
    response_renderAnimated,
    message_style,
    stepAnimation_render,
    type CommandExecuteOptions,
    type ScriptStepPlan,
    type StepAnimationConfig
} from '../ui/tui/TuiRenderer.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract an executable command from a possibly pasted transcript line.
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
 * Resolve a .calypso.yaml script path from user input.
 */
function scriptPath_resolve(scriptRef: string): string | null {
    const trimmedRef: string = scriptRef.trim();
    if (!trimmedRef) return null;

    const withExtension: string = trimmedRef.endsWith('.calypso.yaml') ? trimmedRef : `${trimmedRef}.calypso.yaml`;
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
 * Detect whether a script file uses structured format.
 */
function script_isStructured(content: string): boolean {
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

// ─── Script Execution ───────────────────────────────────────────────────────

/**
 * Execute a .calypso.yaml script (fail-fast).
 * Legacy scripts run client-side; structured scripts delegate to server.
 */
async function script_run(
    scriptRef: string,
    commandExecute: (command: string, options?: CommandExecuteOptions) => Promise<boolean>
): Promise<boolean> {
    const resolvedPath: string | null = scriptPath_resolve(scriptRef);
    if (!resolvedPath) {
        console.log(`${COLORS.dim}○ Local script not found, trying built-in catalog on server...${COLORS.reset}`);
        return commandExecute(`/run ${scriptRef}`);
    }

    const content: string = fs.readFileSync(resolvedPath, 'utf-8');

    if (script_isStructured(content)) {
        console.log(`${COLORS.dim}○ Structured script detected, delegating to server...${COLORS.reset}`);
        return commandExecute(`/run ${scriptRef}`);
    }

    const commands: string[] = scriptCommands_parse(content);
    console.log(`${COLORS.cyan}● Running script:${COLORS.reset} ${COLORS.magenta}${resolvedPath}${COLORS.reset}`);

    if (commands.length === 0) {
        console.log(`${COLORS.yellow}○ Script has no executable commands: ${resolvedPath}${COLORS.reset}`);
        return true;
    }

    for (let i = 0; i < commands.length; i++) {
        const command: string = commands[i];
        console.log(`${COLORS.dim}[RUN ${i + 1}/${commands.length}] ${command}${COLORS.reset}`);
        
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

// ─── Prompt Colorization ────────────────────────────────────────────────────

/**
 * Apply ANSI colors to a raw prompt string.
 */
function prompt_colorize(rawPrompt: string): string {
    const match: RegExpMatchArray | null = rawPrompt.match(/^([^@]+)@([^:]+):\[([^\]]+)\]>\s*$/);
    if (match) {
        const [, user, host, promptPath] = match;
        return `${COLORS.green}${user}${COLORS.reset}@${COLORS.cyan}${host}${COLORS.reset}:[${COLORS.magenta}${promptPath}${COLORS.reset}]> `;
    }
    return `${COLORS.cyan}${rawPrompt}${COLORS.reset}`;
}

// ─── Login ──────────────────────────────────────────────────────────────────

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
            resolve(answer.trim() || 'developer');
        });
    });
}

/**
 * Prompt user to select a persona/workflow.
 */
async function persona_prompt(workflows: WorkflowSummary[], rl: readline.Interface): Promise<string> {
    return new Promise((resolve) => {
        console.log();
        console.log(message_style(`I can guide you through a **structured workflow** if you'd like. Here are the available paths:`));
        console.log();

        workflows.forEach((wf: WorkflowSummary, idx: number): void => {
            console.log(`  ${COLORS.cyan}${idx + 1}.${COLORS.reset} ${COLORS.bright}${wf.name}${COLORS.reset}`);
            console.log(`     ${COLORS.dim}${wf.description} (${wf.stageCount} steps)${COLORS.reset}`);
        });
        console.log(`  ${COLORS.cyan}${workflows.length + 1}.${COLORS.reset} ${COLORS.dim}No guidance needed - I'll explore freely${COLORS.reset}`);
        console.log();

        rl.pause();
        rl.question(`${COLORS.yellow}Which workflow would you like to follow? [1-${workflows.length + 1}]:${COLORS.reset} `, (answer: string) => {
            const choice: number = parseInt(answer.trim(), 10);
            if (isNaN(choice) || choice < 1 || choice > workflows.length + 1) {
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

// ─── Banner ─────────────────────────────────────────────────────────────────

function banner_print(host: string, port: number): void {
    console.log(cliAdapter.banner_render());
    console.log(`${COLORS.dim}Connected to ${host}:${port}${COLORS.reset}`);
    console.log(`${COLORS.dim}Type "/help", "/scripts" to list automation flows, "/run <script>" to execute, "quit" to exit.${COLORS.reset}\n`);
}

// ─── Tab Completion ─────────────────────────────────────────────────────────

function completer_create(client: CalypsoClient): (line: string, callback: (err: Error | null, result: [string[], string]) => void) => void {
    return (line: string, callback: (err: Error | null, result: [string[], string]) => void) => {
        const words = line.split(/\s+/);
        const lastWord = words[words.length - 1] || '';

        // Command completion for first word
        if (words.length === 1 && !line.endsWith(' ')) {
            const allCommands = ['ls', 'cd', 'cat', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'tree',
                'search', 'add', 'gather', 'mount', 'federate', 'pwd', 'env', 'whoami', 'help',
                '/scripts', '/run', 'quit'];
            const matches: string[] = allCommands.filter((c: string): boolean => c.startsWith(lastWord));
            callback(null, [matches, lastWord]);
            return;
        }

        // Path completion via server
        const pathCommands = ['ls', 'cd', 'cat', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'tree'];
        const cmd = words[0]?.toLowerCase();

        if (pathCommands.includes(cmd) || lastWord.startsWith('/') || lastWord.startsWith('~') || lastWord.startsWith('.')) {
            client.tabComplete(lastWord)
                .then(result => callback(null, [result.completions, result.partial]))
                .catch(() => callback(null, [[], lastWord]));
            return;
        }

        // Dataset ID completion
        if (cmd === 'add' || cmd === 'remove') {
            const dsIds = ['ds-001', 'ds-002', 'ds-003', 'ds-004', 'ds-005', 'ds-006'];
            callback(null, [dsIds.filter(id => id.startsWith(lastWord)), lastWord]);
            return;
        }

        callback(null, [[], lastWord]);
    };
}

// ─── REPL ───────────────────────────────────────────────────────────────────

export interface ReplOptions {
    host?: string;
    port?: number;
    url?: string;
}

/**
 * Start the interactive REPL using WebSocket transport.
 */
export async function repl_start(options: ReplOptions = {}): Promise<void> {
    const host = options.host || process.env.CALYPSO_HOST || 'localhost';
    const port = options.port ? options.port : parseInt(process.env.CALYPSO_PORT || '8081', 10);

    const client = new CalypsoClient(options.url ? { url: options.url } : { host, port });

    // Connect via WebSocket
    try {
        await client.connect();
    } catch {
        console.error(`${COLORS.red}>> ERROR: Cannot connect to Calypso server at ws://${host}:${port}/calypso/ws`);
        console.error(`${COLORS.dim}   Make sure the server is running: make calypso${COLORS.reset}`);
        process.exit(1);
    }

    // Login
    const username: string = await login_prompt();
    const loginResponse = await client.login_send(username);
    if (!loginResponse.success) {
        console.error(`${COLORS.red}>> Login failed${COLORS.reset}`);
        process.exit(1);
    }

    console.log(`${COLORS.dim}Authenticating ${loginResponse.username}...${COLORS.reset}`);
    console.log(`${COLORS.green}● Access granted.${COLORS.reset}`);
    console.log();

    banner_print(host, port);

    // v10.2: Live Telemetry Listener
    client.onTelemetry = async (event) => {
        switch (event.type) {
            case 'log':
                console.log(message_style(event.message));
                break;
            case 'progress':
                // In TUI, we handle high-frequency progress via carriage return
                process.stdout.write(`\r${COLORS.dim}   » ${event.label}: ${event.percent}%${COLORS.reset}`);
                if (event.percent === 100) console.log();
                break;
            case 'frame_open':
                rendererFrame_open(event.title, event.subtitle);
                break;
            case 'frame_close':
                rendererFrame_close(event.summary);
                break;
            case 'phase_start':
                rendererPhase_start(event.name);
                break;
            case 'status':
                // Update persistent status line if TUI supports it
                break;
        }
    };

    // Fetch initial prompt
    let currentPrompt: string = prompt_colorize(await client.prompt_fetch());

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: currentPrompt,
        completer: completer_create(client)
    });

    // Greeting
    try {
        const stopGreetSpinner: () => void = spinner_start('CALYPSO initializing');
        const greetingResponse = await client.command_send(`/greet ${username}`);
        stopGreetSpinner();
        if (greetingResponse.message) {
            console.log(message_style(greetingResponse.message));
        }
    } catch {
        // Greeting is optional
    }

    // Workflow selection
    if (loginResponse.workflows.length > 0) {
        const selectedWorkflowId: string = await persona_prompt(loginResponse.workflows, rl);
        const personaResult = await client.persona_send(selectedWorkflowId === 'skip' ? null : selectedWorkflowId);

        if (personaResult.success) {
            console.log();
            if (selectedWorkflowId === 'skip') {
                try {
                    const standbyResponse = await client.command_send(`/standby ${username}`);
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

    // Command execution with TUI rendering
    const command_executeAndRender = async (input: string, options: CommandExecuteOptions = {}): Promise<boolean> => {
        try {
            const spinnerLabel: string = spinnerLabel_resolve(input, options);
            const minSpinnerMs: number = spinnerMinDuration_resolve(input, options);
            const startedAt: number = Date.now();
            const stopSpinner: () => void = spinner_start(spinnerLabel);
            const response = await client.command_send(input);
            const elapsed: number = Date.now() - startedAt;

            // If response has a label, we can't retroactively change the spinner, 
            // but we can ensure future ones use it. 
            // Actually, for now, we just pass hints to the render phase.
            
            if (elapsed < minSpinnerMs) {
                await sleep_ms(minSpinnerMs - elapsed);
            }
            stopSpinner();

            if (response.ui_hints?.animation === 'harmonization' && response.ui_hints.animation_config) {
                await stepAnimation_render(response.ui_hints.animation_config);
            } else {
                await response_renderAnimated(response.message, input, options, response.ui_hints);
            }

            if (process.env.CALYPSO_VERBOSE === 'true' && response.actions.length > 0) {
                const actionTypes: string = response.actions.map((a: CalypsoAction): string => a.type).join(', ');
                console.log(`${COLORS.dim}[Actions: ${actionTypes}]${COLORS.reset}`);
            }

            currentPrompt = prompt_colorize(await client.prompt_fetch());
            rl.setPrompt(currentPrompt);
            return response.success;
        } catch (e: unknown) {
            const error = e instanceof Error ? e.message : 'Unknown error';
            console.log(`${COLORS.red}>> ERROR: ${error}${COLORS.reset}`);
            return false;
        }
    };

    // Main REPL line handler
    rl.on('line', async (line: string) => {
        const extracted: string | null = transcriptCommand_extract(line);
        if (extracted === null) {
            rl.prompt();
            return;
        }

        const input: string = extracted.trim();

        if (input === 'quit' || input === 'exit' || input === 'q') {
            console.log(`${COLORS.dim}Goodbye.${COLORS.reset}`);
            client.disconnect();
            rl.close();
            process.exit(0);
        }

        if (!input) {
            rl.prompt();
            return;
        }

        if (input === '/run' || input.startsWith('/run ')) {
            const scriptRef: string = input.replace(/^\/run\s*/, '').trim();
            if (!scriptRef) {
                console.log(`${COLORS.yellow}Usage: /run <script.calypso.yaml>${COLORS.reset}`);
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
        client.disconnect();
        process.exit(0);
    });
}
