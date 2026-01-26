/**
 * @file LCARS Terminal Component
 * 
 * A simulated terminal emulator styled for the LCARS interface.
 * Supports basic file system navigation and process execution commands.
 * 
 * @module
 */

import type { FileNode } from '../../core/models/types.js';

export class LCARSTerminal {
    private container: HTMLElement;
    private output: HTMLElement;
    private input: HTMLInputElement;
    private prompt: HTMLElement;
    
    private history: string[] = [];
    private historyIndex: number = -1;
    
    private fileSystem: FileNode | null = null;
    private currentPath: string[] = ['home', 'developer']; // default path
    
    // Virtual File System State
    private vfsRoot: FileNode = {
        name: 'root',
        type: 'folder',
        path: '/',
        children: [
            {
                name: 'home',
                type: 'folder',
                path: '/home',
                children: [
                    {
                        name: 'developer',
                        type: 'folder',
                        path: '/home/developer',
                        children: [
                            { name: 'train.py', type: 'file', path: '/home/developer/train.py', size: '2.4 KB' },
                            { name: 'README.md', type: 'file', path: '/home/developer/README.md', size: '1.1 KB' }
                        ]
                    }
                ]
            }
        ]
    };

    constructor(elementId: string) {
        const el = document.getElementById(elementId);
        if (!el) throw new Error(`Terminal container ${elementId} not found`);
        this.container = el;
        
        // Build UI
        this.container.innerHTML = `
            <div class="lcars-terminal-window">
                <div class="lcars-terminal-header">
                    <span class="blink">TERMINAL ACCESS // VFS LINK ACTIVE</span>
                </div>
                <div class="lcars-terminal-output" id="${elementId}-output"></div>
                <div class="lcars-terminal-input-line">
                    <span id="${elementId}-prompt" class="prompt">dev@argus:~/ $</span>
                    <input type="text" id="${elementId}-input" autocomplete="off" spellcheck="false">
                </div>
            </div>
        `;

        this.output = document.getElementById(`${elementId}-output`) as HTMLElement;
        this.input = document.getElementById(`${elementId}-input`) as HTMLInputElement;
        this.prompt = document.getElementById(`${elementId}-prompt`) as HTMLElement;

        this.bindEvents();
        this.println('ATLAS Resource Graphical User System [Version 1.4.0]');
        this.println('Copyright (c) 2026 Federation Computer Systems');
        this.println('');
    }

    /**
     * Mounts a gathered cohort into the VFS.
     */
    public mount(cohort: FileNode): void {
        this.fileSystem = cohort;
        // Find /home/developer and add 'data' folder
        const devFolder = this.findNode(this.vfsRoot, ['home', 'developer']);
        if (devFolder && devFolder.children) {
            // Remove existing data folder if any
            devFolder.children = devFolder.children.filter(c => c.name !== 'data');
            
            // Add new mount
            devFolder.children.push({
                name: 'data',
                type: 'folder',
                path: '/home/developer/data',
                children: [cohort]
            });
        }
        this.println(`<span class="success">>> MOUNT ESTABLISHED: /home/developer/data/${cohort.name}</span>`);
    }

    private bindEvents(): void {
        this.container.addEventListener('click', () => this.input.focus());

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const cmd = this.input.value.trim();
                this.history.push(cmd);
                this.historyIndex = this.history.length;
                this.println(`${this.getPrompt()} ${cmd}`);
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
            }
        });
    }

    private execute(cmdStr: string): void {
        if (!cmdStr) return;
        const parts = cmdStr.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        switch (cmd) {
            case 'help':
                this.println('Available commands: ls, cd, pwd, cat, clear, python, mount');
                break;
            case 'clear':
                this.output.innerHTML = '';
                break;
            case 'pwd':
                this.println('/' + this.currentPath.join('/'));
                break;
            case 'ls':
                this.cmd_ls(args);
                break;
            case 'cd':
                this.cmd_cd(args);
                break;
            case 'python':
                this.cmd_python(args);
                break;
            default:
                this.println(`<span class="error">Command not found: ${cmd}</span>`);
        }
    }

    private cmd_ls(args: string[]): void {
        const targetNode = this.getCurrentNode();
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
        const target = args[0];

        if (target === '..') {
            if (this.currentPath.length > 0) {
                this.currentPath.pop();
            }
        } else if (target === '~') {
            this.currentPath = ['home', 'developer'];
        } else {
            // Simple relative navigation
            const currentNode = this.getCurrentNode();
            const child = currentNode?.children?.find(c => c.name === target && c.type === 'folder');
            
            if (child) {
                this.currentPath.push(child.name);
            } else {
                this.println(`<span class="error">cd: ${target}: No such directory</span>`);
            }
        }
        
        this.updatePrompt();
    }

    private cmd_python(args: string[]): void {
        if (args[0] === 'train.py') {
            this.println('<span class="warn">>> INITIALIZING FEDERATED TRAINING PROTOCOL...</span>');
            this.println('>> CONTACTING NODES: BCH, MGH, BIDMC, BWH...');
            setTimeout(() => {
                // Trigger the global training launch function if it exists
                const win = window as any;
                if (typeof win.training_launch === 'function') {
                    win.training_launch();
                }
            }, 1000);
        } else {
            this.println(`python: can't open file '${args[0]}': [Errno 2] No such file or directory`);
        }
    }

    private getCurrentNode(): FileNode | undefined {
        return this.findNode(this.vfsRoot, this.currentPath);
    }

    private findNode(root: FileNode, pathParts: string[]): FileNode | undefined {
        let current = root;
        // Skip 'root' in path traversal if it's implicit, but my logic above uses 'home' as first part
        // The pathParts usually start after root. 
        // Logic: Root children are 'home'. pathParts[0] is 'home'.
        
        for (const part of pathParts) {
            if (!current.children) return undefined;
            const next = current.children.find(c => c.name === part);
            if (!next) return undefined;
            current = next;
        }
        return current;
    }

    private updatePrompt(): void {
        let displayPath = '/' + this.currentPath.join('/');
        if (displayPath.startsWith('/home/developer')) {
            displayPath = displayPath.replace('/home/developer', '~');
        }
        this.prompt.textContent = `dev@argus:${displayPath} $`;
    }

    private getPrompt(): string {
        return this.prompt.textContent || '$';
    }

    private println(html: string): void {
        const line = document.createElement('div');
        line.className = 'line';
        line.innerHTML = html;
        this.output.appendChild(line);
    }

    private scrollToBottom(): void {
        this.output.scrollTop = this.output.scrollHeight;
    }
}
