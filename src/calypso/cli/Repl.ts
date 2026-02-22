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
import type { CalypsoAction, CalypsoResponse } from '../../lcarslm/types.js';
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
    rendererLog,
    rendererProgress,
    rendererPhase_start,
    rendererStatus,
    response_renderAnimated,
    message_style,
    stepAnimation_render,
    type CommandExecuteOptions
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

// ─── Boot Display ────────────────────────────────────────────────────────────

/**
 * Print a single boot-sequence status line to stdout.
 *
 * Renders one line of the Linux-esque boot log. A WAIT status shows a
 * pending spinner glyph and yellow colour. Terminal statuses (OK, DONE,
 * FAIL) are rendered with a solid prefix and appropriate colour.
 *
 * @param message - Human-readable milestone description.
 * @param status  - Completion token ('OK' | 'WAIT' | 'FAIL' | 'DONE') or null for pending.
 */
function boot_printLine(message: string, status: string | null): void {
    const isWait: boolean = status === 'WAIT' || !status;
    const color: string = isWait ? COLORS.yellow : (status === 'FAIL' ? COLORS.red : COLORS.cyan);
    const text: string = isWait ? ' .... ' : status!.padEnd(6);
    const spinner: string = isWait ? '⠋ ' : '  ';
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${spinner}[ ${color}${text}${COLORS.reset} ] ${message}\n`);
}

interface BootLineRecord {
    message: string;
    status: string | null;
    lineIndex: number;
}

interface BootDisplay {
    render: (event: { id: string; message: string; status: string | null }) => void;
}

/**
 * Create a stateful boot-sequence display for the pre-REPL login phase.
 *
 * The factory returns a renderer that tracks printed milestones by their
 * stable ID. When a milestone transitions from WAIT to OK/FAIL/DONE, the
 * renderer moves the terminal cursor back to that line and overwrites it
 * in place, producing the sequential boot-log appearance familiar from
 * Linux init sequences. Each milestone prints exactly one final line.
 *
 * This renderer is used during the login handshake — before the
 * CalypsoRepl instance is constructed — so that sys_* boot events emitted
 * by calypso.boot() stream to the terminal in real time rather than being
 * dropped because onTelemetry was not yet wired.
 *
 * @returns BootDisplay whose render method processes incoming boot_log events.
 */
function bootDisplay_create(): BootDisplay {
    const lineMap: Map<string, BootLineRecord> = new Map();
    let lineCount: number = 0;
    return {
        render(event: { id: string; message: string; status: string | null }): void {
            const { id, message, status } = event;
            const existing: BootLineRecord | undefined = lineMap.get(id);
            if (existing) {
                const linesBack: number = lineCount - existing.lineIndex;
                readline.moveCursor(process.stdout, 0, -linesBack);
                boot_printLine(message, status);
                readline.moveCursor(process.stdout, 0, linesBack - 1);
                lineMap.set(id, { ...existing, status });
            } else {
                boot_printLine(message, status);
                lineMap.set(id, { message, status, lineIndex: lineCount });
                lineCount++;
            }
        }
    };
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

// ─── REPL Component ─────────────────────────────────────────────────────────

export interface ReplOptions {
    host?: string;
    port?: number;
    url?: string;
}

/**
 * State container for the interactive REPL.
 */
class CalypsoRepl {
    private rl: readline.Interface | null = null;
    private commandInFlight: boolean = false;
    private activeSpinnerStop: (() => void) | null = null;
    private spinnerSuppressedByTelemetry: boolean = false;
    private bootLineMap: Map<string, { message: string, status: string | null, lineIndex: number }> = new Map();
    private bootBlockLineCount: number = 0;
    /** Guards prompt re-display from bootLog_render during startup phase. */
    private startupComplete: boolean = false;

    constructor(
        private readonly client: CalypsoClient,
        private readonly username: string
    ) {}

    /**
     * Initialize the REPL and start the interactive loop.
     */
    public async start(loginResponse: any): Promise<void> {
        this.telemetry_setup();
        
        let currentPrompt: string = prompt_colorize(await this.client.prompt_fetch());

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: currentPrompt,
            completer: this.completer_create()
        });

        // Initial Greeting
        await this.greeting_execute();

        // Persona Selection
        if (loginResponse.workflows.length > 0) {
            await this.workflow_select(loginResponse.workflows);
        }

        console.log();
        // Allow bootLog_render to re-display the prompt once the normal
        // input loop begins. Set this before rl.prompt() so any late-arriving
        // telemetry events do not race ahead of the first prompt.
        this.startupComplete = true;
        this.rl.prompt();

        this.rl.on('line', (l) => this.line_handle(l));
        this.rl.on('close', () => this.shutdown());
    }

    private telemetry_setup(): void {
        this.client.onTelemetry = (event) => {
            if (event.type === 'boot_log') {
                this.bootLog_render(event);
                return;
            }

            if (!this.commandInFlight) return;
            
            if (this.activeSpinnerStop) {
                this.activeSpinnerStop();
                this.activeSpinnerStop = null;
                this.spinnerSuppressedByTelemetry = true;
            }

            switch (event.type) {
                case 'log': rendererLog(event.message); break;
                case 'progress': rendererProgress(event.label, event.percent); break;
                case 'frame_open': rendererFrame_open(event.title, event.subtitle); break;
                case 'frame_close': rendererFrame_close(event.summary); break;
                case 'phase_start': rendererPhase_start(event.name); break;
                case 'status': rendererStatus(event.message); break;
            }
        };
    }

    private bootLog_render(event: { id: string, message: string, status: string | null }): void {
        const { id, message, status } = event;
        const existing = this.bootLineMap.get(id);

        // Only re-display the prompt when the REPL is in its normal interactive
        // loop. During startup (greeting, persona selection) startupComplete is
        // false, preventing bootLog_render from firing a premature prompt that
        // would appear between boot-log lines and the "activated" message.
        const promptVisible = !this.commandInFlight && this.rl && this.startupComplete;
        if (promptVisible) {
            readline.cursorTo(process.stdout, 0);
            readline.clearLine(process.stdout, 0);
        }

        if (existing) {
            const linesBack = this.bootBlockLineCount - existing.lineIndex;
            readline.moveCursor(process.stdout, 0, -linesBack);
            boot_printLine(message, status);
            readline.moveCursor(process.stdout, 0, linesBack - 1);
            this.bootLineMap.set(id, { ...existing, status });
        } else {
            boot_printLine(message, status);
            this.bootLineMap.set(id, { message, status, lineIndex: this.bootBlockLineCount });
            this.bootBlockLineCount++;
        }

        if (promptVisible) this.rl?.prompt(true);
    }

    private async greeting_execute(): Promise<void> {
        try {
            const res = await this.client.command_send(`/greet ${this.username}`);
            if (res.message) console.log(message_style(res.message));
        } catch { /* optional */ }
    }

    private async workflow_select(workflows: WorkflowSummary[]): Promise<void> {
        console.log();
        console.log(message_style(`I can guide you through a **structured workflow** if you'd like. Here are the available paths:`));
        console.log();

        workflows.forEach((wf, idx) => {
            console.log(`  ${COLORS.cyan}${idx + 1}.${COLORS.reset} ${COLORS.bright}${wf.name}${COLORS.reset}`);
            console.log(`     ${COLORS.dim}${wf.description} (${wf.stageCount} steps)${COLORS.reset}`);
        });
        console.log(`  ${COLORS.cyan}${workflows.length + 1}.${COLORS.reset} ${COLORS.dim}No guidance needed - I'll explore freely${COLORS.reset}`);
        console.log();

        const answer = await this.question_ask(`${COLORS.yellow}Which workflow would you like to follow? [1-${workflows.length + 1}]:${COLORS.reset} `);
        const choice = parseInt(answer.trim(), 10);
        let selectedId: string | null = null;

        if (isNaN(choice) || choice < 1 || choice > workflows.length + 1) {
            selectedId = workflows[0]?.id || null;
        } else if (choice !== workflows.length + 1) {
            selectedId = workflows[choice - 1].id;
        }

        const personaResult = await this.client.persona_send(selectedId);
        if (personaResult.success) {
            console.log();
            if (!selectedId) {
                const standbyRes = await this.client.command_send(`/standby ${this.username}`);
                console.log(message_style(standbyRes.message || 'Workflow guidance disabled.'));
            } else {
                const wf = workflows.find(w => w.id === selectedId);
                console.log(message_style(`**${wf?.name || selectedId}** activated. I'll guide you through each step.`));
            }
        }
    }

    private async line_handle(line: string): Promise<void> {
        const extracted = transcriptCommand_extract(line);
        if (extracted === null) {
            this.rl?.prompt();
            return;
        }

        const input = extracted.trim();
        if (!input) {
            this.rl?.prompt();
            return;
        }

        if (input === 'quit' || input === 'exit' || input === 'q') {
            this.shutdown();
            return;
        }

        if (input === '/run' || input.startsWith('/run ')) {
            const scriptRef = input.replace(/^\/run\s*/, '').trim();
            if (!scriptRef) {
                console.log(`${COLORS.yellow}Usage: /run <script.calypso.yaml>${COLORS.reset}`);
            } else {
                await script_run(scriptRef, (c, o) => this.command_execute(c, o));
            }
            this.rl?.prompt();
            return;
        }

        await this.command_execute(input);
        this.rl?.prompt();
    }

    private async command_execute(input: string, options: CommandExecuteOptions = {}): Promise<boolean> {
        this.commandInFlight = true;
        this.spinnerSuppressedByTelemetry = false;
        try {
            const label = spinnerLabel_resolve(input, options);
            const minMs = spinnerMinDuration_resolve(input, options);
            const start = Date.now();
            this.activeSpinnerStop = spinner_start(label);
            
            const response = await this.client.command_send(input);
            const elapsed = Date.now() - start;

            if (!this.spinnerSuppressedByTelemetry && elapsed < minMs) await sleep_ms(minMs - elapsed);
            if (this.activeSpinnerStop) { this.activeSpinnerStop(); this.activeSpinnerStop = null; }

            if (response.ui_hints?.animation === 'harmonization' && response.ui_hints.animation_config) {
                await stepAnimation_render(response.ui_hints.animation_config);
            } else {
                await response_renderAnimated(response.message, input, options, response.ui_hints);
            }

            const prompt = prompt_colorize(await this.client.prompt_fetch());
            this.rl?.setPrompt(prompt);
            return response.success;
        } catch (e: any) {
            if (this.activeSpinnerStop) { this.activeSpinnerStop(); this.activeSpinnerStop = null; }
            console.log(`${COLORS.red}>> ERROR: ${e.message}${COLORS.reset}`);
            return false;
        } finally {
            this.commandInFlight = false;
        }
    }

    private question_ask(query: string): Promise<string> {
        return new Promise(resolve => this.rl?.question(query, resolve));
    }

    private shutdown(): void {
        console.log(`${COLORS.dim}Goodbye.${COLORS.reset}`);
        this.client.disconnect();
        process.exit(0);
    }

    private completer_create(): any {
        return (line: string, callback: any) => {
            const words = line.split(/\s+/);
            const last = words[words.length - 1] || '';
            if (words.length === 1 && !line.endsWith(' ')) {
                const cmds = ['ls', 'cd', 'cat', 'mkdir', 'rm', 'search', 'add', 'gather', 'help', 'quit'];
                callback(null, [cmds.filter(c => c.startsWith(last)), last]);
            } else {
                callback(null, [[], last]);
            }
        };
    }
}

/**
 * Start the interactive REPL using WebSocket transport.
 */
export async function repl_start(options: ReplOptions = {}): Promise<void> {
    const host = options.host || process.env.CALYPSO_HOST || 'localhost';
    const port = options.port || parseInt(process.env.CALYPSO_PORT || '8081', 10);
    const client = new CalypsoClient(options.url ? { url: options.url } : { host, port });

    try {
        await client.connect();
    } catch {
        console.error(`${COLORS.red}>> ERROR: Cannot connect to Calypso server at ws://${host}:${port}/calypso/ws`);
        process.exit(1);
    }

    // 1. LOGIN
    const rlInitial = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(`${COLORS.cyan}╔════════════════════════════════════════════════════════════════╗${COLORS.reset}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}  ${COLORS.bright}CALYPSO TERMINAL ACCESS${COLORS.reset}                                       ${COLORS.cyan}║${COLORS.reset}`);
    console.log(`${COLORS.cyan}╚════════════════════════════════════════════════════════════════╝${COLORS.reset}\n`);
    
    const username = await new Promise<string>(r => rlInitial.question(`${COLORS.yellow}login as:${COLORS.reset} `, r));
    rlInitial.close();

    // Wire the boot display BEFORE login_send() so that sys_* milestones
    // emitted by calypso.boot() on the server stream to the terminal in
    // real time. Without this, all boot_log events arrive and are silently
    // dropped because CalypsoRepl.telemetry_setup() is only called after
    // login completes — the classic subscribe-too-late race condition.
    console.log();
    const bootDisplay: BootDisplay = bootDisplay_create();
    client.onTelemetry = (event): void => {
        if (event.type === 'boot_log') bootDisplay.render(event);
    };

    const loginRes = await client.login_send(username || 'developer');

    // Hand telemetry back; CalypsoRepl.telemetry_setup() will install its
    // own full handler covering both boot_log and command-phase events.
    client.onTelemetry = null;

    if (!loginRes.success) { console.error('Login failed'); process.exit(1); }

    console.log(`${COLORS.green}● Access granted.${COLORS.reset}\n`);
    console.log(cliAdapter.banner_render());
    console.log(`${COLORS.dim}Connected to ${host}:${port}${COLORS.reset}\n`);

    // 2. START REPL
    const repl = new CalypsoRepl(client, loginRes.username);
    await repl.start(loginRes);
}
