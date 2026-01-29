/**
 * @file ARGUS Terminal Implementation
 * 
 * Wraps the generic LCARS Framework Terminal with ARGUS-specific commands
 * and Virtual Filesystem (VFS) integration.
 */

import { LCARSTerminal as BaseTerminal } from '../../lcars-framework/ui/Terminal.js';
import { globals } from '../../core/state/store.js';

export class LCARSTerminal extends BaseTerminal {
    constructor(elementId: string) {
        super({
            elementId,
            title: 'INTELLIGENCE CONSOLE // VFS LINK ACTIVE',
            welcomeMessage: [
                'ATLAS Resource Graphical User System [Version 1.4.0]',
                'Copyright (c) 2026 Federated Computer System',
                ''
            ],
            prompt: 'dev@argus:~/ $',
            onToggle: () => {
                const win = window as any;
                if (typeof win.terminal_toggle === 'function') {
                    win.terminal_toggle();
                }
            }
        });

        this.registerArgusCommands();
        this.setupVfsIntegration();
        this.updatePrompt();
    }

    private registerArgusCommands(): void {

        // VFS Commands
        this.registerCommand({
            name: 'pwd',
            description: 'Print working directory',
            execute: () => this.println(globals.vfs.cwd_get())
        });

        this.registerCommand({
            name: 'ls',
            description: 'List directory contents',
            execute: (args: string[]) => this.cmd_ls(args)
        });

        this.registerCommand({
            name: 'cd',
            description: 'Change directory',
            execute: (args: string[]) => this.cmd_cd(args)
        });

        this.registerCommand({
            name: 'mkdir',
            description: 'Create directory',
            execute: (args: string[]) => {
                try { globals.vfs.dir_create(args[0]); } catch(e: any) { this.println(`<span class="error">${e.message}</span>`); }
            }
        });

        this.registerCommand({
            name: 'touch',
            description: 'Create empty file',
            execute: (args: string[]) => {
                try { globals.vfs.file_create(args[0]); } catch(e: any) { this.println(`<span class="error">${e.message}</span>`); }
            }
        });

        // Workflow Commands
        this.registerCommand({
            name: 'federate',
            description: 'Transform script into MERIDIAN app and launch',
            execute: (args) => this.cmd_federate(args)
        });

        this.registerCommand({
            name: 'whoami',
            description: 'Display current user',
            execute: () => this.println('developer')
        });

        this.registerCommand({
            name: 'date',
            description: 'Display current date',
            execute: () => this.println(new Date().toString())
        });

        this.registerCommand({
            name: 'echo',
            description: 'Display a line of text',
            execute: (args) => this.println(args.join(' '))
        });

        // Override help to include ARGUS workflow info
        this.registerCommand({
            name: 'help',
            description: 'Display available commands',
            execute: () => {
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
                this.println('  <span class="highlight">federate &lt;script&gt;</span> - Transform script into MERIDIAN app and launch.');
                this.println('  <span class="highlight">clear</span>            - Purge terminal buffer.');
                this.println('<span class="dim">================================================================</span>');
            }
        });
    }

    private setupVfsIntegration(): void {
        this.onTabComplete = (value: string): string | string[] | null => {
            const parts: string[] = value.split(/\s+/);
            const lastPart: string = parts[parts.length - 1];
            if (!lastPart && parts.length > 1) return null;

            const cwdPath: string = globals.vfs.cwd_get();
            const targetNode = globals.vfs.node_stat(cwdPath);
            if (!targetNode || !targetNode.children) return null;

            const matches = targetNode.children.filter(c =>
                c.name.toLowerCase().startsWith(lastPart.toLowerCase())
            );

            if (matches.length === 1) {
                const match = matches[0];
                const suffix: string = match.type === 'folder' ? '/' : '';
                parts[parts.length - 1] = match.name + suffix;
                return parts.join(' ');
            } else if (matches.length > 1) {
                return matches.map(m => m.name + (m.type === 'folder' ? '/' : ''));
            }
            return null;
        };
    }

    private cmd_ls(args: string[]): void {
        const cwdPath: string = globals.vfs.cwd_get();
        const targetNode = globals.vfs.node_stat(cwdPath);
        if (!targetNode || !targetNode.children) return;

        targetNode.children.forEach(child => {
            let colorClass: string = 'file';
            if (child.type === 'folder') colorClass = 'dir';
            else if (child.name.endsWith('.py')) colorClass = 'exec';

            const size: string = child.size || '4 KB';
            const name: string = child.type === 'folder' ? `${child.name}/` : child.name;

            this.println(`<span class="${colorClass}">${name.padEnd(20)}</span> <span class="dim">${size}</span>`);
        });
    }

    private cmd_cd(args: string[]): void {
        if (args.length === 0) return;
        try {
            globals.vfs.cwd_set(args[0]);
            this.updatePrompt();
        } catch (e: any) {
            this.println(`<span class="error">${e.message}</span>`);
        }
    }

    private cmd_federate(args: string[]): void {
        if (args.length === 0) {
            this.println('federate: missing script operand');
            return;
        }
        if (args[0] === 'train.py') {
            this.println('<span class="warn">>> INITIATING FEDERALIZATION PROTOCOL...</span>');
            this.println('>> UPLOADING ASSETS TO ATLAS FACTORY...');
            this.println('>> RESOLVING MERIDIAN DEPENDENCIES...');
            setTimeout(() => {
                const win = window as any;
                if (typeof win.training_launch === 'function') {
                    win.training_launch();
                } else {
                    this.println('<span class="error">>> ERROR: FEDERALIZATION ENGINE OFFLINE.</span>');
                }
            }, 1500);
        } else {
            this.println(`federate: '${args[0]}' is not a valid MERIDIAN training script.`);
        }
    }

    public updatePrompt(): void {
        let displayPath: string = globals.vfs.cwd_get();
        const homePath: string = globals.vfs.home_get();
        if (displayPath.startsWith(homePath)) {
            displayPath = displayPath.replace(homePath, '~');
        }
        this.setPrompt(`dev@argus:${displayPath} $`);
    }
}
