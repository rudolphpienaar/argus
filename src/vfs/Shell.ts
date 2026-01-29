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
import type { FileNode } from './types.js';

/**
 * A builtin command definition.
 *
 * @property name - Command name (lowercase).
 * @property description - Human-readable description for help output.
 * @property execute - Handler that returns a ShellResult.
 */
interface BuiltinCommand {
    name: string;
    description: string;
    execute: (args: string[]) => ShellResult;
}

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
 *
 * @example
 * ```typescript
 * const shell = new Shell(vfs, 'developer');
 * const result: ShellResult = shell.command_execute('ls ~/src');
 * // result.stdout contains colorized directory listing
 * ```
 */
export class Shell {
    private vfs: VirtualFileSystem;
    private env: Map<string, string>;
    private builtins: Map<string, BuiltinCommand>;
    private commandHistory: string[];
    private externalHandler: ExternalHandler | null = null;
    private username: string;

    /**
     * Creates a new Shell instance attached to a VFS.
     *
     * @param vfs - The Virtual File System instance.
     * @param username - The current user (defaults to 'user').
     */
    constructor(vfs: VirtualFileSystem, username: string = 'user') {
        this.vfs = vfs;
        this.username = username;
        this.commandHistory = [];
        this.builtins = new Map<string, BuiltinCommand>();
        this.env = new Map<string, string>();
        
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
        
        // Register builtins
        this.builtins_register();
    }

    // ─── External Handler ───────────────────────────────────────

    /**
     * Sets a callback for commands not handled by builtins.
     * Used by the ARGUS Terminal to handle domain-specific commands
     * (federate, search, add, review, mount, clear).
     *
     * @param handler - Callback that receives command name and args.
     */
    public externalHandler_set(handler: ExternalHandler): void {
        this.externalHandler = handler;
    }

    // ─── Command Execution ──────────────────────────────────────

    /**
     * Parses and executes a raw command line string.
     * Returns a ShellResult with stdout, stderr, and exit code.
     *
     * @param line - Raw input from the terminal.
     * @returns The result of command execution.
     */
    public command_execute(line: string): ShellResult {
        const trimmed: string = line.trim();
        if (!trimmed) return result_ok('');

        // Record in history
        this.commandHistory.push(trimmed);

        // Parse command and arguments
        const parts: string[] = trimmed.split(/\s+/);
        const command: string = parts[0].toLowerCase();
        const args: string[] = parts.slice(1);

        // Try builtin first
        const builtin: BuiltinCommand | undefined = this.builtins.get(command);
        if (builtin) {
            return builtin.execute(args);
        }

        // Try external handler
        if (this.externalHandler) {
            const extResult: ShellResult | null = this.externalHandler(command, args);
            if (extResult !== null) {
                return extResult;
            }
        }

        return result_err(`${command}: command not found`, 127);
    }

    // ─── Environment Variables ──────────────────────────────────

    /**
     * Returns the value of an environment variable.
     *
     * @param key - Variable name (without $).
     * @returns The value, or undefined if not set.
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
     *
     * @param key - Variable name (without $).
     * @param value - Variable value.
     */
    public env_set(key: string, value: string): void {
        this.env.set(key, value);
    }

    /**
     * Returns all environment variables as a Map.
     *
     * @returns A copy of the environment map (with $PWD synced).
     */
    public env_all(): Map<string, string> {
        const copy: Map<string, string> = new Map(this.env);
        copy.set('PWD', this.vfs.cwd_get());
        return copy;
    }

    // ─── Prompt Generation ──────────────────────────────────────

    /**
     * Evaluates the $PS1 format string to produce the terminal prompt.
     * Replaces $VARIABLE references with their values.
     * Applies ~ substitution for $HOME prefix in $PWD.
     *
     * @returns The rendered prompt string.
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
     * Updates $STAGE and cd's to the persona's landing directory.
     *
     * @param stage - The new SeaGaP stage name.
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
     *
     * @returns Array of previously executed command strings.
     */
    public history_get(): string[] {
        return [...this.commandHistory];
    }

    // ─── Builtin Registration ───────────────────────────────────

    /**
     * Registers all builtin commands.
     */
    private builtins_register(): void {
        this.builtin_add('cd', 'Change directory', (args: string[]): ShellResult => {
            const target: string = args[0] || '~';
            try {
                this.vfs.cwd_set(target);
                this.env.set('PWD', this.vfs.cwd_get());
                return result_ok('');
            } catch (e: unknown) {
                return result_err(e instanceof Error ? e.message : String(e), 1);
            }
        });

        this.builtin_add('pwd', 'Print working directory', (_args: string[]): ShellResult => {
            return result_ok(this.vfs.cwd_get());
        });

        this.builtin_add('ls', 'List directory contents', (args: string[]): ShellResult => {
            const target: string = args[0] || '.';
            try {
                const children: FileNode[] = this.vfs.dir_list(
                    this.vfs.path_resolve(target)
                );
                const lines: string[] = children.map((child: FileNode): string => {
                    let colorClass: string = 'file';
                    if (child.type === 'folder') colorClass = 'dir';
                    else if (child.name.endsWith('.py') || child.name.endsWith('.sh')) colorClass = 'exec';

                    const size: string = child.size || '0 B';
                    const name: string = child.type === 'folder' ? `${child.name}/` : child.name;
                    return `<span class="${colorClass}">${name.padEnd(24)}</span> <span class="dim">${size}</span>`;
                });
                return result_ok(lines.join('\n'));
            } catch (e: unknown) {
                return result_err(e instanceof Error ? e.message : String(e), 1);
            }
        });

        this.builtin_add('cat', 'Print file contents', (args: string[]): ShellResult => {
            if (args.length === 0) {
                return result_err('cat: missing operand', 1);
            }
            try {
                const content: string | null = this.vfs.node_read(args[0]);
                if (content === null) {
                    return result_err(`cat: ${args[0]}: Is a directory or has no content`, 1);
                }
                return result_ok(content);
            } catch (e: unknown) {
                return result_err(e instanceof Error ? e.message : String(e), 1);
            }
        });

        this.builtin_add('mkdir', 'Create directory', (args: string[]): ShellResult => {
            if (args.length === 0) {
                return result_err('mkdir: missing operand', 1);
            }
            try {
                this.vfs.dir_create(args[0]);
                return result_ok('');
            } catch (e: unknown) {
                return result_err(e instanceof Error ? e.message : String(e), 1);
            }
        });

        this.builtin_add('touch', 'Create empty file or update timestamp', (args: string[]): ShellResult => {
            if (args.length === 0) {
                return result_err('touch: missing operand', 1);
            }
            try {
                this.vfs.file_create(args[0]);
                return result_ok('');
            } catch (e: unknown) {
                return result_err(e instanceof Error ? e.message : String(e), 1);
            }
        });

        this.builtin_add('rm', 'Remove file or directory', (args: string[]): ShellResult => {
            const recursive: boolean = args.includes('-r') || args.includes('-rf');
            const paths: string[] = args.filter((a: string): boolean => !a.startsWith('-'));
            if (paths.length === 0) {
                return result_err('rm: missing operand', 1);
            }
            try {
                for (const p of paths) {
                    this.vfs.node_remove(p, recursive);
                }
                return result_ok('');
            } catch (e: unknown) {
                return result_err(e instanceof Error ? e.message : String(e), 1);
            }
        });

        this.builtin_add('cp', 'Copy file or directory', (args: string[]): ShellResult => {
            if (args.length < 2) {
                return result_err('cp: missing operand', 1);
            }
            try {
                this.vfs.node_copy(args[0], args[1]);
                return result_ok('');
            } catch (e: unknown) {
                return result_err(e instanceof Error ? e.message : String(e), 1);
            }
        });

        this.builtin_add('mv', 'Move or rename file or directory', (args: string[]): ShellResult => {
            if (args.length < 2) {
                return result_err('mv: missing operand', 1);
            }
            try {
                this.vfs.node_move(args[0], args[1]);
                return result_ok('');
            } catch (e: unknown) {
                return result_err(e instanceof Error ? e.message : String(e), 1);
            }
        });

        this.builtin_add('echo', 'Display text with variable expansion', (args: string[]): ShellResult => {
            const expanded: string = this.vars_expand(args.join(' '));
            return result_ok(expanded);
        });

        this.builtin_add('env', 'Print all environment variables', (_args: string[]): ShellResult => {
            const envMap: Map<string, string> = this.env_all();
            const lines: string[] = [];
            envMap.forEach((value: string, key: string) => {
                lines.push(`${key}=${value}`);
            });
            lines.sort();
            return result_ok(lines.join('\n'));
        });

        this.builtin_add('export', 'Set an environment variable', (args: string[]): ShellResult => {
            if (args.length === 0) {
                return result_err('export: missing KEY=VALUE', 1);
            }
            const eqIndex: number = args[0].indexOf('=');
            if (eqIndex <= 0) {
                return result_err('export: invalid format. Use: export KEY=VALUE', 1);
            }
            const key: string = args[0].substring(0, eqIndex);
            const value: string = args[0].substring(eqIndex + 1);
            this.env.set(key, value);
            return result_ok('');
        });

        this.builtin_add('whoami', 'Print current user', (_args: string[]): ShellResult => {
            return result_ok(this.env.get('USER') || 'unknown');
        });

        this.builtin_add('date', 'Print current date and time', (_args: string[]): ShellResult => {
            return result_ok(new Date().toString());
        });

        this.builtin_add('history', 'Show command history', (_args: string[]): ShellResult => {
            const lines: string[] = this.commandHistory.map(
                (cmd: string, i: number): string => `  ${String(i + 1).padStart(4)}  ${cmd}`
            );
            return result_ok(lines.join('\n'));
        });

        this.builtin_add('help', 'List available commands', (_args: string[]): ShellResult => {
            const lines: string[] = ['<span class="success">AVAILABLE COMMANDS:</span>'];
            const sorted: BuiltinCommand[] = [...this.builtins.values()].sort(
                (a: BuiltinCommand, b: BuiltinCommand) => a.name.localeCompare(b.name)
            );
            for (const cmd of sorted) {
                lines.push(`  <span class="highlight">${cmd.name.padEnd(12)}</span> ${cmd.description}`);
            }
            return result_ok(lines.join('\n'));
        });
    }

    // ─── Internal Helpers ───────────────────────────────────────

    /**
     * Registers a single builtin command.
     *
     * @param name - Command name.
     * @param description - Human-readable description.
     * @param execute - Handler function.
     */
    private builtin_add(
        name: string,
        description: string,
        execute: (args: string[]) => ShellResult
    ): void {
        this.builtins.set(name, { name, description, execute });
    }

    /**
     * Expands $VARIABLE references in a string.
     * Supports $HOME, $USER, $PWD, $STAGE, $PERSONA, and any custom vars.
     *
     * @param input - String containing $VARIABLE references.
     * @returns String with variables expanded.
     */
    private vars_expand(input: string): string {
        return input.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match: string, varName: string): string => {
            if (varName === 'PWD') return this.vfs.cwd_get();
            return this.env.get(varName) ?? `$${varName}`;
        });
    }

    /**
     * Resolves the landing directory for a given SeaGaP stage.
     *
     * @param stage - SeaGaP stage name.
     * @returns Absolute path of the landing directory.
     */
    private stageLanding_resolve(stage: string): string {
        const home: string = this.env.get('HOME') || '/home/user';
        switch (stage) {
            case 'search':   return home;
            case 'gather':   return `${home}/data/cohort`;
            case 'process':  return `${home}/src/project`;
            case 'monitor':  return `${home}/src/project`;
            case 'post':     return `${home}/results`;
            default:         return home;
        }
    }
}

// ─── Result Constructors ────────────────────────────────────────

/**
 * Creates a successful ShellResult.
 *
 * @param stdout - Output text.
 * @returns ShellResult with exitCode 0.
 */
function result_ok(stdout: string): ShellResult {
    return { stdout, stderr: '', exitCode: 0 };
}

/**
 * Creates an error ShellResult.
 *
 * @param stderr - Error message.
 * @param exitCode - Non-zero exit code.
 * @returns ShellResult with the given error and exit code.
 */
function result_err(stderr: string, exitCode: number = 1): ShellResult {
    return { stdout: '', stderr, exitCode };
}
