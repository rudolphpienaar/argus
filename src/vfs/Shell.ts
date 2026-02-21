/**
 * @file Shell — VCS Command Interpreter
 *
 * The Shell is the command interpreter layer between the Terminal UI
 * and the VirtualFileSystem. It owns environment variables, prompt
 * generation, command history, and all builtin commands.
 *
 * The Terminal becomes a dumb I/O surface: it sends raw input strings
 * to the Shell and renders whatever ShellResult the Shell returns.
 *
 * All methods follow the RPN naming convention: <subject>_<verb>.
 *
 * @module
 */

import type { VirtualFileSystem } from './VirtualFileSystem.js';
import type { ShellResult } from './types.js';
import { ShellBuiltins } from './ShellBuiltins.js';

/**
 * Callback for commands that need async or side-effect behavior
 * beyond what the Shell can handle (e.g., `federate`, `clear`).
 *
 * @param command - The command name.
 * @param args - The parsed arguments.
 * @returns A ShellResult, or null to fall through to "command not found".
 */
type ExternalHandler = (command: string, args: string[]) => ShellResult | null;

/**
 * The VCS Shell — a POSIX-like command interpreter.
 *
 * Owns environment variables, prompt generation, command history,
 * and all filesystem builtin commands. Returns ShellResult objects
 * for the Terminal to render.
 */
export class Shell {
    private env: Map<string, string>;
    private builtins: ShellBuiltins;
    private commandHistory: string[];
    private externalHandler: ExternalHandler | null = null;
    private cwdChangeHandler: ((newCwd: string) => void) | null = null;
    private username: string;

    /**
     * Creates a new Shell instance attached to a VFS.
     *
     * @param vfs - The Virtual File System instance.
     * @param username - The current user (defaults to 'user').
     */
    constructor(
        public readonly vfs: VirtualFileSystem, // Public for Builtins access
        username: string = 'user'
    ) {
        this.username = username;
        this.commandHistory = [];
        this.env = new Map<string, string>();
        this.builtins = new ShellBuiltins(vfs);
        
        // Initialize environment variables
        this.env.set('USER', username);
        this.env.set('HOME', `/home/${username}`);
        this.env.set('PATH', `/bin:/usr/bin:/home/${username}/bin`);
        this.env.set('SHELL', '/bin/bash');
        this.env.set('TERM', 'xterm-256color');
        this.env.set('PWD', `/home/${username}`);
        this.env.set('PERSONA', 'fedml'); // Default initial persona
        this.env.set('PS1', '$USER@argus:$PWD $ ');
        this.env.set('STAGE', 'search'); // Default stage
        
        // Ensure HOME exists
        try { this.vfs.dir_create(this.env.get('HOME')!); } catch { /* ignore */ }
        this.vfs.cwd_set(this.env.get('HOME')!);
    }

    // ─── External Handler ───────────────────────────────────────

    /**
     * Sets a callback for commands not handled by builtins.
     * Used by the ARGUS Terminal to handle domain-specific commands.
     */
    public externalHandler_set(handler: ExternalHandler): void {
        this.externalHandler = handler;
    }

    /**
     * Sets a callback invoked whenever `cd` changes the working directory.
     */
    public onCwdChange_set(handler: ((newCwd: string) => void) | null): void {
        this.cwdChangeHandler = handler;
    }

    /**
     * Whether a command string corresponds to a registered shell builtin.
     */
    public isBuiltin(command: string): boolean {
        return !!this.builtins.REGISTRY[command.toLowerCase()];
    }

    // ─── Command Execution ──────────────────────────────────────

    /**
     * Parses and executes a raw command line string.
     */
    public async command_execute(line: string): Promise<ShellResult> {
        const trimmed: string = line.trim();
        if (!trimmed) return { stdout: '', stderr: '', exitCode: 0 };

        // Record in history
        this.commandHistory.push(trimmed);

        // Expand variables
        const expanded = this.vars_expand(trimmed);

        // Parse command and arguments
        const parts: string[] = expanded.split(/\s+/);
        const command: string = parts[0].toLowerCase();
        const args: string[] = parts.slice(1);

        // Try builtin first
        const builtinHandler = this.builtins.REGISTRY[command];
        if (builtinHandler) {
            return await builtinHandler(args, this);
        }

        // Try external handler
        if (this.externalHandler) {
            const extResult: ShellResult | null = this.externalHandler(command, args);
            if (extResult !== null) {
                return extResult;
            }
        }

        return { stdout: '', stderr: `${command}: command not found`, exitCode: 127 };
    }

    /**
     * Trigger the CWD change callback.
     * Called by 'cd' builtin.
     */
    public cwd_didChange(newCwd: string): void {
        if (this.cwdChangeHandler) {
            this.cwdChangeHandler(newCwd);
        }
    }

    /**
     * Expands $VARIABLE references in a string.
     */
    private vars_expand(input: string): string {
        return input.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match: string, varName: string): string => {
            if (varName === 'PWD') return this.vfs.cwd_get();
            return this.env.get(varName) ?? `$${varName}`;
        });
    }

    // ─── Environment Variables ──────────────────────────────────

    /**
     * Returns the value of an environment variable.
     */
    public env_get(key: string): string | undefined {
        // $PWD is always synced with VFS
        if (key === 'PWD') {
            return this.vfs.cwd_get();
        }
        return this.env.get(key);
    }

    /**
     * Sets an environment variable.
     */
    public env_set(key: string, value: string): void {
        this.env.set(key, value);
    }

    /**
     * Returns all environment variables as a Map.
     */
    public env_all(): Map<string, string> {
        const copy: Map<string, string> = new Map(this.env);
        copy.set('PWD', this.vfs.cwd_get());
        return copy;
    }

    public env_snapshot(): Record<string, string> {
        const snap: Record<string, string> = {};
        for (const [k, v] of this.env) {
            snap[k] = v;
        }
        snap['PWD'] = this.vfs.cwd_get();
        return snap;
    }

    // ─── Prompt Generation ──────────────────────────────────────

    /**
     * Evaluates the $PS1 format string to produce the terminal prompt.
     */
    public prompt_render(): string {
        const ps1: string = this.env.get('PS1') || '$ ';
        const homePath: string = this.env.get('HOME') || '/home/user';
        let pwd: string = this.vfs.cwd_get();

        // Cosmetic ~ substitution
        if (pwd.startsWith(homePath)) {
            pwd = '~' + pwd.substring(homePath.length);
        }
        if (pwd === '') pwd = '~';

        // Evaluate $VARIABLE references in PS1
        let rendered: string = ps1;
        rendered = rendered.replace(/\$PWD/g, pwd);
        this.env.forEach((value: string, key: string) => {
            if (key !== 'PWD') {
                rendered = rendered.replace(new RegExp(`\\$${key}`, 'g'), value);
            }
        });

        return rendered;
    }

    // ─── Stage Transitions ──────────────────────────────────────

    /**
     * Called when the application transitions between SeaGaP stages.
     */
    public stage_enter(stage: string): void {
        this.env.set('STAGE', stage);

        // cd to stage-appropriate directory
        const landingPath: string = this.stageLanding_resolve(stage);
        try {
            // Ensure the directory exists
            this.vfs.dir_create(landingPath);
            this.vfs.cwd_set(landingPath);
            this.env.set('PWD', this.vfs.cwd_get());
        } catch (_e: unknown) {
            // If landing dir fails, stay where we are
        }
    }

    /**
     * Returns the command history array.
     */
    public history_get(): string[] {
        return [...this.commandHistory];
    }

    // ─── Internal Helpers ───────────────────────────────────────

    /**
     * Resolves the landing directory for a given SeaGaP stage.
     */
    private stageLanding_resolve(stage: string): string {
        const home: string = this.env.get('HOME') || '/home/user';
        const project: string | undefined = this.env.get('PROJECT');
        switch (stage) {
            case 'search':   return home;
            case 'gather':   return project ? `${home}/projects/${project}/input` : home;
            case 'process': {
                if (!project) return `${home}/projects`;
                const projectRoot = `${home}/projects/${project}`;
                const srcPath = `${projectRoot}/src`;
                // If src exists (structured project), land there. Otherwise root (draft).
                if (this.vfs.node_stat(srcPath)) {
                    return srcPath;
                }
                return projectRoot;
            }
            case 'monitor':  return project ? `${home}/projects/${project}/src` : `${home}/projects`; // Monitor assumes code exists
            case 'post':     return `${home}/results`;
            default:         return home;
        }
    }
}
