/**
 * @file ARGUS Terminal Implementation
 *
 * Wraps the generic LCARS Framework Terminal with VCS Shell integration.
 * The Terminal is a dumb I/O surface: it sends raw input to the Shell
 * and renders the ShellResult (stdout in default color, stderr in red).
 *
 * Command resolution order:
 *   1. Base terminal commands (clear)
 *   2. Shell builtins (cd, ls, cat, etc.)
 *   3. Fallback handler (CalypsoCore workflow + AI commands)
 *
 * @module
 */

import { LCARSTerminal as BaseTerminal } from '../../lcars-framework/ui/Terminal.js';
import { globals } from '../../core/state/store.js';
import { Typewriter } from '../anim/Typewriter.js';
import type { Shell } from '../../vfs/Shell.js';
import type { ShellResult, FileNode } from '../../vfs/types.js';

// Window.terminal_toggle and Window.training_launch are declared in argus.ts

/**
 * Async fallback handler for commands not recognized by the Shell.
 * Used for AI/workflow commands (search, add, review, mount, simulate, LLM queries).
 *
 * @param cmd - The command name.
 * @param args - The parsed arguments.
 */
type FallbackHandler = (cmd: string, args: string[]) => Promise<void>;

/**
 * ARGUS-specific terminal that delegates all command execution to the VCS Shell.
 * Commands the Shell does not recognize (exit code 127) are forwarded to an
 * optional async fallback handler for AI/workflow processing.
 *
 * @example
 * ```typescript
 * const terminal = new LCARSTerminal('intelligence-console');
 * terminal.shell_connect(shell);
 * terminal.fallback_set(async (cmd, args) => { ... });
 * ```
 */
export class LCARSTerminal extends BaseTerminal {
    private shell: Shell | null = null;
    private fallbackHandler: FallbackHandler | null = null;

    constructor(elementId: string) {
        super({
            elementId,
            title: 'CALYPSO INTELLIGENCE CONSOLE // VFS LINK ACTIVE',
            welcomeMessage: [
                'ATLAS Resource Guided User System [Version 1.4.0]',
                'Copyright (c) 2026 Federated Computer System',
                ''
            ],
            prompt: 'dev@argus:~/ $',
            onToggle: (): void => {
                if (typeof window.terminal_toggle === 'function') {
                    window.terminal_toggle();
                }
            }
        });

        this.styles_inject();
        this.shellIntegration_setup();
        this.tabCompletion_setup();
    }

    /**
     * Injects custom CSS for terminal-specific candy (progress bars, tables).
     */
    private styles_inject(): void {
        const style = document.createElement('style');
        style.textContent = `
            .lcars-progress-block {
                display: flex;
                align-items: center;
                gap: 10px;
                margin: 5px 0;
                font-family: 'Antonio', sans-serif;
                letter-spacing: 1px;
            }
            .lcars-progress-block .progress-label {
                width: 150px;
                color: var(--canary);
                font-size: 0.8rem;
            }
            .lcars-progress-block .progress-track {
                flex: 1;
                height: 12px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                overflow: hidden;
                position: relative;
            }
            .lcars-progress-block .progress-fill {
                height: 100%;
                background: var(--sky);
                width: 0;
                box-shadow: 0 0 10px var(--sky);
            }
            .lcars-progress-block .progress-percent {
                width: 40px;
                font-size: 0.8rem;
                color: var(--font-color);
                text-align: right;
            }

            @keyframes lcars-progress-grow {
                from { width: 0; }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Connects the Shell to this terminal. Must be called after both
     * the terminal and shell are initialized.
     *
     * Clears shell external command handling in browser mode, re-registers
     * `help` to delegate to
     * the Shell (overriding the base terminal's help), and syncs the
     * prompt from $PS1.
     *
     * @param shell - The VCS Shell instance.
     */
    public shell_connect(shell: Shell): void {
        this.shell = shell;

        // Browser mode keeps Shell focused on builtins; workflow/domain
        // commands are routed through terminal fallback -> CalypsoCore.
        shell.externalHandler_set((): ShellResult | null => null);

        // Override base terminal's `help` to delegate to Shell's richer help
        this.registerCommand({
            name: 'help',
            description: 'List available commands',
            execute: async (): Promise<void> => {
                const result: ShellResult = await shell.command_execute('help');
                if (result.stdout) {
                    const lines: string[] = result.stdout.split('\n');
                    for (const l of lines) {
                        this.println(l);
                    }
                }
            }
        });

        // Sync prompt from Shell's $PS1
        this.prompt_sync();
    }

    /**
     * Sets the async fallback handler for commands not recognized by the Shell.
     * Called when the Shell returns exit code 127 (command not found).
     *
     * @param handler - Async callback for AI/workflow command processing.
     */
    public fallback_set(handler: FallbackHandler): void {
        this.fallbackHandler = handler;
    }

    /**
     * Syncs the terminal prompt from the Shell's $PS1 evaluation.
     * Call this after any operation that may change CWD or env vars.
     */
    public prompt_sync(): void {
        if (this.shell) {
            this.setPrompt(this.shell.prompt_render());
        }
    }

    /**
     * Renders text character-by-character to the terminal.
     * Used for AI responses to simulate the "MU/TH/UR" interface.
     * 
     * @param text - The text content to type.
     * @param styleClass - Optional CSS class (e.g., 'muthur-text').
     */
    public async printStream(text: string, styleClass: string = ''): Promise<void> {
        const line = document.createElement('div');
        line.className = `line ${styleClass}`;
        this.output.appendChild(line);
        
        const typewriter = new Typewriter(line, 20);
        await typewriter.type(text);
        
        this.scrollToBottom();
    }

    /**
     * Renders text, waits, and then removes it via reverse-typewriter.
     * Used for non-persistent interruptions (idle prompts).
     * 
     * @param text - The text content.
     * @param styleClass - CSS class.
     * @param duration - How long to wait before backspacing (default 5s).
     */
    public async printTransientStream(text: string, styleClass: string = '', duration: number = 5000): Promise<void> {
        const line = document.createElement('div');
        line.className = `line ${styleClass}`;
        this.output.appendChild(line);
        
        const typewriter = new Typewriter(line, 20);
        await typewriter.type(text);
        
        // Wait
        await new Promise(resolve => setTimeout(resolve, duration));
        
        // Backspace
        await typewriter.backspace();
        
        // Remove from DOM
        line.remove();
    }

    // ─── Shell Integration ──────────────────────────────────────

    /**
     * Hooks into the base terminal's command execution pipeline.
     * Intercepts all input and delegates to the Shell. If the Shell
     * returns exit code 127 (command not found), the fallback handler
     * is invoked for AI/workflow processing.
     */
    private shellIntegration_setup(): void {
        // Register 'clear' in the base terminal since it needs
        // DOM access the Shell doesn't have.
        this.registerCommand({
            name: 'clear',
            description: 'Clear the terminal buffer',
            execute: (): void => this.clear()
        });

        // All other commands go through the Shell via unhandled handler
        this.onUnhandledCommand = async (cmd: string, args: string[]): Promise<void> => {
            if (!this.shell) {
                // Shell not yet connected — try fallback directly
                if (this.fallbackHandler) {
                    await this.fallbackHandler(cmd, args);
                } else {
                    this.println(`<span class="error">Shell not connected</span>`);
                }
                return;
            }

            const routedCommand: string = cmd.toLowerCase();
            const workflowCommands: Set<string> = new Set<string>([
                'search',
                'add',
                'remove',
                'review',
                'gather',
                'mount',
                'proceed',
                'code',
                'rename',
                'harmonize',
                'federate'
            ]);

            // Force workflow/domain commands through CalypsoCore fallback so
            // browser and CLI command semantics stay aligned.
            if (this.fallbackHandler && workflowCommands.has(routedCommand)) {
                await this.fallbackHandler(cmd, args);
                this.prompt_sync();
                return;
            }

            // Reconstruct the full command line for the Shell
            const line: string = [cmd, ...args].join(' ');
            const result: ShellResult = await this.shell.command_execute(line);

            // If Shell doesn't recognize the command, try fallback handler
            if (result.exitCode === 127 && this.fallbackHandler) {
                await this.fallbackHandler(cmd, args);
                this.prompt_sync();
                return;
            }

            // Render Shell result
            this.result_render(result);

            // Sync prompt after any command (cd, export, etc. may change it)
            this.prompt_sync();
        };
    }

    /**
     * Renders a ShellResult to the terminal output.
     * Stdout lines are printed in default color; stderr in error styling.
     *
     * @param result - The ShellResult to render.
     */
    private result_render(result: ShellResult): void {
        if (result.stdout) {
            const lines: string[] = result.stdout.split('\n');
            for (const l of lines) {
                this.println(l);
            }
        }
        if (result.stderr) {
            this.println(`<span class="error">${result.stderr}</span>`);
        }
    }

    /**
     * Sets up VFS-aware tab completion.
     * Completes file and directory names relative to the current working directory.
     */
    private tabCompletion_setup(): void {
        this.onTabComplete = (value: string): string | string[] | null => {
            const parts: string[] = value.split(/\s+/);
            const lastPart: string = parts[parts.length - 1];
            if (!lastPart && parts.length > 1) return null;

            const cwdPath: string = globals.vcs.cwd_get();
            const targetNode: FileNode | null = globals.vcs.node_stat(cwdPath);
            if (!targetNode || !targetNode.children) return null;

            const matches: FileNode[] = targetNode.children.filter(
                (c: FileNode): boolean => c.name.toLowerCase().startsWith(lastPart.toLowerCase())
            );

            if (matches.length === 1) {
                const match: FileNode = matches[0];
                const suffix: string = match.type === 'folder' ? '/' : '';
                parts[parts.length - 1] = match.name + suffix;
                return parts.join(' ');
            } else if (matches.length > 1) {
                return matches.map((m: FileNode): string => m.name + (m.type === 'folder' ? '/' : ''));
            }
            return null;
        };
    }

}
