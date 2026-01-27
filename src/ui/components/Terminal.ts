/**
 * @file LCARS Terminal Component
 * 
 * A simulated terminal emulator styled for the LCARS interface.
 * Supports basic file system navigation and process execution commands.
 * 
 * @module
 */

import { globals } from '../../core/state/store.js';

/**
 * A simulated terminal emulator styled for the LCARS interface.
 * Supports basic file system navigation and process execution commands.
 */
export class LCARSTerminal {
    private container: HTMLElement;
    private output: HTMLElement;
    private input: HTMLInputElement;
    private prompt: HTMLElement;
    
    private history: string[] = [];
    private historyIndex: number = -1;

    /** Callback for handling commands not recognized by the terminal. */
    public onUnhandledCommand: ((cmd: string, args: string[]) => Promise<void>) | null = null;

    /**
     * Creates a new LCARSTerminal instance.
     * 
     * @param elementId - The ID of the DOM element to mount the terminal in.
     * @throws {Error} If the element is not found.
     */
    constructor(elementId: string) {
        const el = document.getElementById(elementId);
        if (!el) throw new Error(`Terminal container ${elementId} not found`);
        this.container = el;
        
        // Build UI
        this.container.innerHTML = `
            <div class="lcars-terminal-wrapper">
                <div class="lcars-terminal-header-bar">
                    <div class="lcars-bar-horizontal">
                        <span class="lcars-title">INTELLIGENCE CONSOLE // VFS LINK ACTIVE</span>
                        <span class="lcars-terminal-status" id="${elementId}-status">MODE: [INITIALIZING]</span>
                    </div>
                    <div class="lcars-bar-end" id="${elementId}-toggle"></div>
                </div>
                <div class="lcars-terminal-body">
                    <div class="lcars-terminal-screen">
                        <div class="lcars-terminal-output" id="${elementId}-output"></div>
                        <div class="lcars-terminal-input-line">
                            <span id="${elementId}-prompt" class="prompt">dev@argus:~/ $</span>
                            <input type="text" id="${elementId}-input" autocomplete="off" spellcheck="false">
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.output = document.getElementById(`${elementId}-output`) as HTMLElement;
        this.input = document.getElementById(`${elementId}-input`) as HTMLInputElement;
        this.prompt = document.getElementById(`${elementId}-prompt`) as HTMLElement;

        // Set up toggle listener
        const toggleBtn = document.getElementById(`${elementId}-toggle`);
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const win = window as any;
                if (typeof win.terminal_toggle === 'function') {
                    win.terminal_toggle();
                }
            });
        }

        this.bindEvents();
        this.println('ATLAS Resource Graphical User System [Version 1.4.0]');
        this.println('Copyright (c) 2026 Federated Computer System');
        this.println('');
        this.updatePrompt();
    }

    private bindEvents(): void {
        this.container.addEventListener('click', () => this.input.focus());

        this.input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                const cmd: string = this.input.value.trim();
                this.history.push(cmd);
                this.historyIndex = this.history.length;
                this.println(`${this.getPrompt()} <span class="user-input">${cmd}</span>`);
                this.input.value = '';
                this.execute(cmd);
                this.scrollToBottom();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (this.historyIndex > 0) {
                    this.historyIndex--;
                    this.input.value = this.history[this.historyIndex];
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (this.historyIndex < this.history.length - 1) {
                    this.historyIndex++;
                    this.input.value = this.history[this.historyIndex];
                } else {
                    this.historyIndex = this.history.length;
                    this.input.value = '';
                }
            } else if (e.key === 'Tab') {
                e.preventDefault();
                this.handleTabCompletion();
            }
        });
    }

    private handleTabCompletion(): void {
        const value = this.input.value;
        const parts = value.split(/\s+/);
        const lastPart = parts[parts.length - 1];
        if (!lastPart && parts.length > 1) return; // Nothing to complete

        const targetNode = globals.vfs.getCwdNode();
        if (!targetNode || !targetNode.children) return;

        const matches = targetNode.children.filter(c => 
            c.name.toLowerCase().startsWith(lastPart.toLowerCase())
        );

        if (matches.length === 1) {
            const match = matches[0];
            const suffix = match.type === 'folder' ? '/' : '';
            parts[parts.length - 1] = match.name + suffix;
            this.input.value = parts.join(' ');
        } else if (matches.length > 1) {
            // Print options if multiple matches
            this.println('');
            const matchNames = matches.map(m => m.name + (m.type === 'folder' ? '/' : ''));
            this.println(`<span class="dim">MATCHES: ${matchNames.join('  ')}</span>`);
            this.updatePrompt(); // Redraw prompt line simulation
            this.println(`${this.getPrompt()} <span class="user-input">${value}</span>`);
        }
    }

    private async execute(cmdStr: string): Promise<void> {
        if (!cmdStr) return;
        const parts: string[] = cmdStr.split(/\s+/);
        const cmd: string = parts[0].toLowerCase();
        const args: string[] = parts.slice(1);

        switch (cmd) {
            case 'help':
                this.println('<span class="highlight">ARGUS INTELLIGENCE CONSOLE - OPERATIONAL GUIDE</span>');
                this.println('<span class="dim">================================================================</span>');
                this.println('<span class="success">TERMINAL-DRIVEN WORKFLOW:</span>');
                this.println('  <span class="highlight">search &lt;query&gt;</span>  - Scan catalog and display matching datasets.');
                this.println('  <span class="highlight">add &lt;id&gt;</span>         - Toggle dataset selection into cohort buffer.');
                this.println('  <span class="highlight">review</span>           - Switch to Gather view to inspect cohort/costs.');
                this.println('  <span class="highlight">mount</span>            - Finalize cohort and mount Virtual Filesystem.');
                this.println('');
                this.println('<span class="success">SYSTEM COMMANDS:</span>');
                this.println('  <span class="highlight">ls / cd / pwd</span>    - Navigate the Virtual Filesystem.');
                this.println('  <span class="highlight">cat &lt;file&gt;</span>       - Read file contents.');
                this.println('  <span class="highlight">python &lt;script&gt;</span>  - Execute processing scripts (e.g., train.py).');
                this.println('  <span class="highlight">clear</span>            - Purge terminal buffer.');
                this.println('<span class="dim">================================================================</span>');
                break;
            case 'clear':
                this.output.innerHTML = '';
                break;
            case 'pwd':
                this.println(globals.vfs.getCwd());
                break;
            case 'ls':
                this.cmd_ls(args);
                break;
            case 'cd':
                this.cmd_cd(args);
                break;
            case 'mkdir':
                try { globals.vfs.mkdir(args[0]); } catch(e: any) { this.println(`<span class="error">${e.message}</span>`); }
                break;
            case 'touch':
                try { globals.vfs.touch(args[0]); } catch(e: any) { this.println(`<span class="error">${e.message}</span>`); }
                break;
            case 'rm':
                // Stub for rm if needed
                this.println('<span class="dim">Command not implemented in VFS prototype.</span>');
                break;
            case 'whoami':
                this.println('developer');
                break;
            case 'date':
                this.println(new Date().toString());
                break;
            case 'echo':
                this.println(args.join(' '));
                break;
            default:
                if (this.onUnhandledCommand) {
                    await this.onUnhandledCommand(cmd, args);
                } else {
                    this.println(`<span class="error">Command not found: ${cmd}</span>`);
                }
        }
    }

    private cmd_ls(args: string[]): void {
        const targetNode = globals.vfs.getCwdNode();
        if (!targetNode || !targetNode.children) return;

        const table = document.createElement('table');
        table.className = 'ls-table';
        
        targetNode.children.forEach(child => {
            let colorClass = 'file';
            if (child.type === 'folder') colorClass = 'dir';
            else if (child.name.endsWith('.py')) colorClass = 'exec';
            
            const size = child.size || '4 KB';
            const name = child.type === 'folder' ? `${child.name}/` : child.name;
            
            this.println(`<span class="${colorClass}">${name.padEnd(20)}</span> <span class="dim">${size}</span>`);
        });
    }

    private cmd_cd(args: string[]): void {
        if (args.length === 0) return;
        try {
            globals.vfs.cd(args[0]);
            this.updatePrompt();
        } catch (e: any) {
            this.println(`<span class="error">${e.message}</span>`);
        }
    }

    private cmd_cat(args: string[]): void {
        // Simple stub for now
        this.println(`[Content of ${args[0]}]`);
    }

    /**
     * Clears the terminal output and history.
     */
    public clear(): void {
        this.output.innerHTML = '';
        this.history = [];
        this.historyIndex = -1;
    }

    /**
     * Sets the terminal status text in the header.
     * 
     * @param text - The new status text.
     */
    public setStatus(text: string): void {
        const statusEl: HTMLElement | null = document.getElementById(`${this.container.id}-status`);
        if (statusEl) {
            statusEl.textContent = text;
        }
    }

    /**
     * Sets the terminal prompt text.
     * 
     * @param text - The new prompt text.
     */
    public setPrompt(text: string): void {
        this.prompt.textContent = text;
    }

    /**
     * Prints a line of text to the terminal output.
     * 
     * @param html - The HTML string to print.
     */
    public println(html: string): void {
        const line: HTMLDivElement = document.createElement('div');
        line.className = 'line';
        line.innerHTML = html;
        this.output.appendChild(line);
        this.scrollToBottom();
    }

    public updatePrompt(): void {
        let displayPath = globals.vfs.getCwd();
        if (displayPath.startsWith('/home/developer')) {
            displayPath = displayPath.replace('/home/developer', '~');
        }
        this.prompt.textContent = `dev@argus:${displayPath} $`;
    }

    private getPrompt(): string {
        return this.prompt.textContent || '$';
    }

    private scrollToBottom(): void {
        this.output.scrollTop = this.output.scrollHeight;
    }
}