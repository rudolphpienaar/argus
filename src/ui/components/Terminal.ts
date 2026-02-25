/**
 * @file ARGUS Terminal Implementation
 *
 * Wraps the generic LCARS Framework Terminal with VCS Shell integration.
 * The Terminal is a dumb I/O surface: it sends raw input to the Shell
 * and renders the ShellResult (stdout in default color, stderr in red).
 */

import { LCARSTerminal as BaseTerminal } from '../../lcars-framework/ui/Terminal.js';
import { store } from '../../core/state/store.js';
import { Typewriter } from '../anim/Typewriter.js';
import type { Shell } from '../../vfs/Shell.js';
import type { ShellResult, FileNode } from '../../vfs/types.js';

type FallbackHandler = (cmd: string, args: string[]) => Promise<void>;

/**
 * ARGUS-specific terminal that delegates all command execution to the VCS Shell.
 */
export class LCARSTerminal extends BaseTerminal {
    private shell: Shell | null = null;
    private fallbackHandler: FallbackHandler | null = null;
    private bootLines: Map<string, HTMLElement> = new Map();

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
                if (typeof (window as any).terminal_toggle === 'function') {
                    (window as any).terminal_toggle();
                }
            }
        });

        this.styles_inject();
        this.shellIntegration_setup();
        this.tabCompletion_setup();
    }

    /**
     * Handles specialized boot telemetry log events.
     * Implements in-place status replacement with spinners.
     */
    public bootLog_handle(event: { id: string, message: string, status: string | null }): void {
        const { id, message, status } = event;
        const finalStatus = status || 'WAIT';
        const isWaiting = finalStatus === 'WAIT';
        
        let lineEl = this.bootLines.get(id);
        
        if (!lineEl) {
            lineEl = document.createElement('div');
            lineEl.className = 'line boot-log-line';
            this.output.appendChild(lineEl);
            this.bootLines.set(id, lineEl);
        }

        const statusClass = isWaiting ? 'boot-status-wait' : 'boot-status-ok';
        const spinner = isWaiting ? '<span class="boot-spinner"></span>' : '';
        const statusText = isWaiting ? ' .... ' : finalStatus.padEnd(6);

        lineEl.innerHTML = `[ <span class="${statusClass}">${spinner}${statusText}</span> ] ${message}`;
        
        if (finalStatus === 'DONE') {
            this.bootLines.delete(id);
        }

        this.scrollToBottom();
    }

    private styles_inject(): void {
        const style = document.createElement('style');
        style.textContent = `
            .boot-log-line {
                font-family: 'Courier New', monospace;
                font-size: 0.85rem;
                margin: 2px 0;
                display: flex;
                gap: 10px;
                white-space: pre;
            }
            .boot-status-wait { color: var(--canary); display: inline-flex; align-items: center; min-width: 50px; }
            .boot-status-ok { color: var(--sky); font-weight: bold; min-width: 50px; }
            .boot-spinner {
                display: inline-block;
                width: 10px;
                height: 10px;
                border: 2px solid rgba(255,255,255,0.2);
                border-radius: 50%;
                border-top-color: var(--canary);
                animation: boot-spin 1s linear infinite;
                margin-right: 8px;
            }
            @keyframes boot-spin { to { transform: rotate(360deg); } }
        `;
        document.head.appendChild(style);
    }

    public shell_connect(shell: Shell): void {
        this.shell = shell;
        shell.externalHandler_set((): ShellResult | null => null);
        this.registerCommand({
            name: 'help',
            description: 'List available commands',
            execute: async (): Promise<void> => {
                const result: ShellResult = await shell.command_execute('help');
                if (result.stdout) {
                    const lines: string[] = result.stdout.split('\n');
                    for (const l of lines) { this.println(l); }
                }
            }
        });
        this.prompt_sync();
    }

    public fallback_set(handler: FallbackHandler): void {
        this.fallbackHandler = handler;
    }

    public prompt_sync(): void {
        if (this.shell) {
            this.setPrompt(this.shell.prompt_render());
        }
    }

    public async printStream(text: string, styleClass: string = ''): Promise<void> {
        const line = document.createElement('div');
        line.className = `line ${styleClass}`;
        this.output.appendChild(line);
        const typewriter = new Typewriter(line, 20);
        await typewriter.type(text);
        this.scrollToBottom();
    }

    private shellIntegration_setup(): void {
        this.registerCommand({
            name: 'clear',
            description: 'Clear the terminal buffer',
            execute: (): void => this.clear()
        });

        this.onUnhandledCommand = async (cmd: string, args: string[]): Promise<void> => {
            if (!this.shell) {
                if (this.fallbackHandler) { await this.fallbackHandler(cmd, args); }
                else { this.println(`<span class="error">Shell not connected</span>`); }
                return;
            }

            const line: string = [cmd, ...args].join(' ');
            const result: ShellResult = await this.shell.command_execute(line);

            if (result.exitCode === 127 && this.fallbackHandler) {
                await this.fallbackHandler(cmd, args);
                this.prompt_sync();
                return;
            }

            this.result_render(result);
            this.prompt_sync();
        };
    }

    private result_render(result: ShellResult): void {
        if (result.stdout) {
            const lines: string[] = result.stdout.split('\n');
            for (const l of lines) { this.println(l); }
        }
        if (result.stderr) {
            this.println(`<span class="error">${result.stderr}</span>`);
        }
    }

    private tabCompletion_setup(): void {
        this.onTabComplete = (value: string): string | string[] | null => {
            const parts: string[] = value.split(/\s+/);
            const lastPart: string = parts[parts.length - 1];
            if (!lastPart && parts.length > 1) return null;

            const cwdPath: string = store.globals.vcs.cwd_get();
            const targetNode: FileNode | null = store.globals.vcs.node_stat(cwdPath);
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
