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
    private logicalPwd: string;
    private boundaryPath: string | null = null;

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
        
        const homeDir = `/home/${username}`;
        this.logicalPwd = homeDir;

        // Initialize environment variables
        this.env.set('USER', username);
        this.env.set('HOME', homeDir);
        this.env.set('PATH', `/bin:/usr/bin:/home/${username}/bin`);
        this.env.set('SHELL', '/bin/bash');
        this.env.set('TERM', 'xterm-256color');
        this.env.set('PWD', homeDir);
        this.env.set('PERSONA', 'fedml'); // Default initial persona
        this.env.set('PS1', '$USER@argus:$PWD $ ');
        this.env.set('STAGE', 'search'); // Default stage
        
        // Ensure HOME exists
        try { this.vfs.dir_create(homeDir); } catch { /* ignore */ }
        this.vfs.cwd_set(homeDir);
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

    /**
     * Return all registered builtin command names.
     */
    public builtins_list(): string[] {
        return Object.keys(this.builtins.REGISTRY);
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
     * Set the current working directory (logical and physical).
     *
     * @param path - The target directory path.
     * @returns A warning message if leaving the boundary, or null.
     */
    public cwd_set(path: string): string | null {
        const physical = this.vfs.path_resolveSpecific(this.vfs.cwd_get(), path);
        this.vfs.cwd_set(physical);
        
        const oldLogical = this.logicalPwd;
        const newLogical = this.vfs.path_resolveSpecific(oldLogical, path);
        
        this.logicalPwd = newLogical;
        this.env.set('PWD', newLogical);
        
        if (this.cwdChangeHandler) {
            this.cwdChangeHandler(newLogical);
        }

        // Boundary Guard: Detect if we were inside the boundary and are now outside
        if (this.boundaryPath && oldLogical.startsWith(this.boundaryPath)) {
            if (!newLogical.startsWith(this.boundaryPath)) {
                return "○ You are leaving your scratch space... to return type 'cd @'";
            }
        }

        return null;
    }

    /**
     * Set the active navigation boundary (scratch space).
     */
    public boundary_set(path: string | null): void {
        this.boundaryPath = path;
    }

    /**
     * Trigger the CWD change callback.
     * Called by 'cd' builtin.
     *
     * @param newCwd - The new working directory path after the change.
     */
    public cwd_didChange(newCwd: string): void {
        // Now handled by Shell.cwd_set
    }

    /**
     * Expands $VARIABLE references in a string.
     *
     * @param input - Raw command string potentially containing $VAR references.
     * @returns Input string with all known $VARIABLE tokens substituted.
     */
    private vars_expand(input: string): string {
        return input.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match: string, varName: string): string => {
            if (varName === 'PWD') return this.logicalPwd;
            return this.env.get(varName) ?? `$${varName}`;
        });
    }

    // ─── Environment Variables ──────────────────────────────────

    /**
     * Returns the value of an environment variable.
     */
    public env_get(key: string): string | undefined {
        if (key === 'PWD') {
            return this.logicalPwd;
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
     * Removes an environment variable from shell state.
     */
    public env_unset(key: string): void {
        this.env.delete(key);
    }

    /**
     * Returns all environment variables as a Map.
     */
    public env_all(): Map<string, string> {
        const copy: Map<string, string> = new Map(this.env);
        copy.set('PWD', this.logicalPwd);
        return copy;
    }

    /**
     * Return all environment variables as a plain object snapshot.
     *
     * @returns A plain Record of all current environment variable key-value pairs.
     */
    public env_snapshot(): Record<string, string> {
        const snap: Record<string, string> = {};
        for (const [k, v] of this.env) {
            snap[k] = v;
        }
        snap['PWD'] = this.logicalPwd;
        return snap;
    }

    // ─── Prompt Generation ──────────────────────────────────────

    /**
     * Evaluates the $PS1 format string to produce the terminal prompt.
     */
    public prompt_render(): string {
        const ps1: string = this.env.get('PS1') || '$ ';
        const homePath: string = this.env.get('HOME') || '/home/user';
        let pwd: string = this.logicalPwd;

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
            this.cwd_set(landingPath);
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

    /**
     * Clears the shell command history buffer.
     */
    public history_clear(): void {
        this.commandHistory = [];
    }

    // ─── Internal Helpers ───────────────────────────────────────

    /**
     * Resolves the landing directory for a given SeaGaP stage.
     *
     * @param stage - The stage identifier (e.g. 'search', 'gather', 'process').
     * @returns Absolute VFS path to navigate to when entering this stage.
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
