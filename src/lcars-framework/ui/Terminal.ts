/**
 * @file Generic LCARS Terminal Component
 * 
 * A reusable terminal emulator styled for the LCARS interface.
 * Supports command registration and history.
 */

export interface TerminalCommand {
    name: string;
    description: string;
    execute: (args: string[], terminal: LCARSTerminal) => Promise<void> | void;
}

export interface TerminalOptions {
    elementId: string;
    title?: string;
    welcomeMessage?: string[];
    prompt?: string;
    onToggle?: () => void;
}

export class LCARSTerminal {
    protected container: HTMLElement;
    protected output: HTMLElement;
    private input: HTMLInputElement;
    private promptEl: HTMLElement;
    private statusEl: HTMLElement;
    
    private history: string[] = [];
    private historyIndex: number = -1;
    private commands: Map<string, TerminalCommand> = new Map();

    public onUnhandledCommand: ((cmd: string, args: string[]) => Promise<void>) | null = null;
    public onTabComplete: ((value: string) => string | string[] | null) | null = null;

    constructor(options: TerminalOptions) {
        const {
            elementId,
            title = 'INTELLIGENCE CONSOLE',
            welcomeMessage = ['LCARS Terminal Active'],
            prompt = '$ ',
            onToggle
        } = options;

        const el = document.getElementById(elementId);
        if (!el) throw new Error(`Terminal container ${elementId} not found`);
        this.container = el;
        
        this.container.innerHTML = `
            <div class="lcars-terminal-wrapper">
                <div class="lcars-terminal-header-bar">
                    <div class="lcars-bar-horizontal">
                        <span class="lcars-title">${title}</span>
                        <span class="lcars-terminal-status" id="${elementId}-status">MODE: [READY]</span>
                    </div>
                    <div class="lcars-bar-end" id="${elementId}-toggle"></div>
                </div>
                <div class="lcars-terminal-body">
                    <div class="lcars-terminal-screen">
                        <div class="lcars-terminal-output" id="${elementId}-output"></div>
                        <div class="lcars-terminal-input-line">
                            <span id="${elementId}-prompt" class="prompt">${prompt}</span>
                            <input type="text" id="${elementId}-input" autocomplete="off" spellcheck="false">
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.output = document.getElementById(`${elementId}-output`) as HTMLElement;
        this.input = document.getElementById(`${elementId}-input`) as HTMLInputElement;
        this.promptEl = document.getElementById(`${elementId}-prompt`) as HTMLElement;
        this.statusEl = document.getElementById(`${elementId}-status`) as HTMLElement;

        if (onToggle) {
            document.getElementById(`${elementId}-toggle`)?.addEventListener('click', onToggle);
        }

        this.bindEvents();
        
        if (welcomeMessage) {
            welcomeMessage.forEach(msg => this.println(msg));
        }

        // Register default commands
        this.registerCommand({
            name: 'help',
            description: 'Display available commands',
            execute: () => {
                this.println('<span class="success">AVAILABLE COMMANDS:</span>');
                this.commands.forEach(cmd => {
                    this.println(`  <span class="highlight">${cmd.name.padEnd(12)}</span> - ${cmd.description}`);
                });
            }
        });

        this.registerCommand({
            name: 'clear',
            description: 'Clear the terminal buffer',
            execute: () => this.clear()
        });
    }

    private bindEvents(): void {
        this.container.addEventListener('click', () => this.input.focus());

        this.input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                const cmdLine = this.input.value.trim();
                if (cmdLine) {
                    this.history.push(cmdLine);
                    this.historyIndex = this.history.length;
                    this.println(`${this.getPrompt()} <span class="user-input">${cmdLine}</span>`);
                    this.execute(cmdLine);
                }
                this.input.value = '';
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
        if (!this.onTabComplete) return;

        const value = this.input.value;
        const result = this.onTabComplete(value);

        if (typeof result === 'string') {
            this.input.value = result;
        } else if (Array.isArray(result) && result.length > 0) {
            this.println('');
            this.println(`<span class="dim">MATCHES: ${result.join('  ')}</span>`);
            this.println(`${this.getPrompt()} <span class="user-input">${value}</span>`);
        }
    }

    public registerCommand(cmd: TerminalCommand): void {
        this.commands.set(cmd.name.toLowerCase(), cmd);
    }

    private async execute(cmdStr: string): Promise<void> {
        const parts = cmdStr.split(/\s+/);
        const name = parts[0].toLowerCase();
        const args = parts.slice(1);

        const command = this.commands.get(name);
        if (command) {
            try {
                await command.execute(args, this);
            } catch (err: unknown) {
                if (err instanceof Error) {
                    this.println(`<span class="error">Error: ${err.message}</span>`);
                } else {
                    this.println(`<span class="error">Error: Unknown error occurred</span>`);
                }
            }
        } else if (this.onUnhandledCommand) {
            await this.onUnhandledCommand(name, args);
        } else {
            this.println(`<span class="error">Command not found: ${name}</span>`);
        }
    }

    public println(html: string): void {
        const line = document.createElement('div');
        line.className = 'line';
        line.innerHTML = html;
        this.output.appendChild(line);
        this.scrollToBottom();
    }

    public clear(): void {
        this.output.innerHTML = '';
    }

    public setStatus(text: string): void {
        this.statusEl.textContent = text;
    }

    public setPrompt(text: string): void {
        this.promptEl.textContent = text;
    }

    public getPrompt(): string {
        return this.promptEl.textContent || '$ ';
    }

    protected scrollToBottom(): void {
        this.output.scrollTop = this.output.scrollHeight;
    }

    public focus(): void {
        this.input.focus();
    }
}
