/**
 * @file LCARS Terminal Component
 * 
 * A simulated terminal emulator styled for the LCARS interface.
 * Supports basic file system navigation and process execution commands.
 * 
 * @module
 */

import type { FileNode } from '../../core/models/types.js';

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
        this.println('Copyright (c) 2026 Federation Computer Systems');
        this.println('');
    }

    /**
     * Mounts a gathered cohort into the VFS.
     * 
     * @param cohort - The FileNode representing the gathered data.
     */
    public mount(cohort: FileNode): void {
        this.fileSystem = cohort;
        // Find /home/developer and add 'data' folder
        const devFolder: FileNode | undefined = this.findNode(this.vfsRoot, ['home', 'developer']);
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
            }
        });
    }

    private async execute(cmdStr: string): Promise<void> {
        if (!cmdStr) return;
        const parts: string[] = cmdStr.split(/\s+/);
        const cmd: string = parts[0].toLowerCase();
        const args: string[] = parts.slice(1);

        switch (cmd) {
            case 'help':
                this.println('Available commands: ls, cd, pwd, cat, mkdir, touch, rm, whoami, date, echo, clear, python, mount');
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
            case 'cat':
                this.cmd_cat(args);
                break;
            case 'mkdir':
                this.cmd_mkdir(args);
                break;
            case 'touch':
                this.cmd_touch(args);
                break;
            case 'rm':
                this.cmd_rm(args);
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
            case 'python':
                this.cmd_python(args);
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

    private cmd_cat(args: string[]): void {
        if (args.length === 0) {
            this.println('cat: missing operand');
            return;
        }
        const target = args[0];
        const currentNode = this.getCurrentNode();
        const file = currentNode?.children?.find(c => c.name === target && c.type !== 'folder');

        if (file) {
            if (file.name.endsWith('.py')) {
                this.println('<span class="code">import atlas... # (file content hidden)</span>');
            } else if (file.name.endsWith('.md')) {
                this.println('# Project README\n\n Federated learning setup for chest x-ray analysis.');
            } else {
                this.println(`[Content of ${file.name}]`);
            }
        } else {
            this.println(`cat: ${target}: No such file or directory`);
        }
    }

    private cmd_mkdir(args: string[]): void {
        if (args.length === 0) {
            this.println('mkdir: missing operand');
            return;
        }
        const target = args[0];
        const currentNode = this.getCurrentNode();
        
        if (currentNode && currentNode.children) {
            if (currentNode.children.some(c => c.name === target)) {
                this.println(`mkdir: cannot create directory '${target}': File exists`);
            } else {
                currentNode.children.push({
                    name: target,
                    type: 'folder',
                    path: `${currentNode.path === '/' ? '' : currentNode.path}/${target}`,
                    children: []
                });
            }
        }
    }

    private cmd_touch(args: string[]): void {
        if (args.length === 0) {
            this.println('touch: missing operand');
            return;
        }
        const target = args[0];
        const currentNode = this.getCurrentNode();
        
        if (currentNode && currentNode.children) {
            if (!currentNode.children.some(c => c.name === target)) {
                currentNode.children.push({
                    name: target,
                    type: 'file',
                    path: `${currentNode.path === '/' ? '' : currentNode.path}/${target}`,
                    size: '0 B'
                });
            }
        }
    }

    private cmd_rm(args: string[]): void {
        if (args.length === 0) {
            this.println('rm: missing operand');
            return;
        }
        const target = args[0];
        const currentNode = this.getCurrentNode();
        
        if (currentNode && currentNode.children) {
            const index = currentNode.children.findIndex(c => c.name === target);
            if (index !== -1) {
                const node = currentNode.children[index];
                if (node.type === 'folder' && !args.includes('-r') && !args.includes('-rf')) {
                    this.println(`rm: cannot remove '${target}': Is a directory`);
                } else {
                    currentNode.children.splice(index, 1);
                }
            } else {
                this.println(`rm: cannot remove '${target}': No such file or directory`);
            }
        }
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
        let current: FileNode = root;
        // Skip 'root' in path traversal if it's implicit, but my logic above uses 'home' as first part
        // The pathParts usually start after root. 
        // Logic: Root children are 'home'. pathParts[0] is 'home'.
        
        for (const part of pathParts) {
            if (!current.children) return undefined;
            const next: FileNode | undefined = current.children.find(c => c.name === part);
            if (!next) return undefined;
            current = next;
        }
        return current;
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

    private scrollToBottom(): void {
        this.output.scrollTop = this.output.scrollHeight;
    }
}
