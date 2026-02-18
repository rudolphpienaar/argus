/**
 * @file Shell Builtins
 *
 * Implements POSIX-like builtin commands for the Virtual Shell.
 *
 * @module vfs/builtins
 */

import type { VirtualFileSystem } from './VirtualFileSystem.js';
import type { Shell } from './Shell.js';
import type { ShellResult, FileNode } from './types.js';

export type BuiltinHandler = (args: string[], shell: Shell) => Promise<ShellResult>;

interface PythonRunContext {
    scriptPath: string;
    resolvedPath: string;
    runRootPath: string;
    outputDirPath: string;
    modelPath: string;
    statsPath: string;
    inputDisplayPath: string;
    isChrisValidation: boolean;
}

export class ShellBuiltins {
    constructor(private vfs: VirtualFileSystem) {}

    public readonly REGISTRY: Record<string, BuiltinHandler> = {
        'cd': this.cd.bind(this),
        'ls': this.ls.bind(this),
        'pwd': this.pwd.bind(this),
        'cat': this.cat.bind(this),
        'echo': this.echo.bind(this),
        'mkdir': this.mkdir.bind(this),
        'touch': this.touch.bind(this),
        'rm': this.rm.bind(this),
        'cp': this.cp.bind(this),
        'mv': this.mv.bind(this),
        'tree': this.tree.bind(this),
        'env': this.env.bind(this),
        'export': this.export.bind(this),
        'whoami': this.whoami.bind(this),
        'date': this.date.bind(this),
        'history': this.history.bind(this),
        'help': this.help.bind(this),
        'python': this.python.bind(this),
        'upload': this.upload.bind(this)
    };

    private async cd(args: string[], shell: Shell): Promise<ShellResult> {
        const target = args[0] || shell.env_get('HOME') || '/';
        try {
            this.vfs.cwd_set(target);
            const newCwd = this.vfs.cwd_get();
            shell.env_set('PWD', newCwd);
            shell.cwd_didChange(newCwd);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `cd: ${this.errorMessage_get(error)}`, exitCode: 1 };
        }
    }

    private async ls(args: string[], shell: Shell): Promise<ShellResult> {
        const target = args[0] || this.vfs.cwd_get();
        try {
            const resolvedPath = this.vfs.path_resolve(target);
            const targetNode = this.vfs.node_stat(resolvedPath);
            if (!targetNode) {
                return { stdout: '', stderr: `ls: cannot access '${target}': No such file or directory`, exitCode: 1 };
            }

            const entry_render = (entry: FileNode): string => {
                let resolvedEntry = entry;
                let colorClass = 'file';
                if (resolvedEntry.type === 'folder') {
                    colorClass = 'dir';
                } else if (resolvedEntry.name.endsWith('.py') || resolvedEntry.name.endsWith('.sh')) {
                    colorClass = 'exec';
                }

                if (resolvedEntry.type === 'file' && resolvedEntry.content === null && resolvedEntry.contentGenerator) {
                    this.vfs.node_read(resolvedEntry.path);
                    const refreshed = this.vfs.node_stat(resolvedEntry.path);
                    if (refreshed) resolvedEntry = refreshed;
                }

                const size = resolvedEntry.size || '0 B';
                const name = resolvedEntry.type === 'folder' ? `${resolvedEntry.name}/` : resolvedEntry.name;
                return `<span class="${colorClass}">${name.padEnd(24)}</span> <span class="size-highlight">${size}</span>`;
            };

            if (targetNode.type === 'file') {
                return { stdout: entry_render(targetNode), stderr: '', exitCode: 0 };
            }

            const children = this.vfs.dir_list(resolvedPath);
            const lines = children.map(child => entry_render(child));
            return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `ls: ${this.errorMessage_get(error)}`, exitCode: 1 };
        }
    }

    private async pwd(args: string[], shell: Shell): Promise<ShellResult> {
        return { stdout: this.vfs.cwd_get(), stderr: '', exitCode: 0 };
    }

    private async cat(args: string[], shell: Shell): Promise<ShellResult> {
        if (args.length === 0) return { stdout: '', stderr: 'cat: missing operand', exitCode: 1 };
        try {
            const content = this.vfs.node_read(args[0]);
            if (content === null) {
                return { stdout: '', stderr: `cat: ${args[0]}: Is a directory or has no content`, exitCode: 1 };
            }
            return { stdout: content, stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `cat: ${this.errorMessage_get(error)}`, exitCode: 1 };
        }
    }

    private async echo(args: string[], shell: Shell): Promise<ShellResult> {
        return { stdout: args.join(' '), stderr: '', exitCode: 0 };
    }

    private async mkdir(args: string[], shell: Shell): Promise<ShellResult> {
        if (args.length === 0) return { stdout: '', stderr: 'mkdir: missing operand', exitCode: 1 };
        try {
            this.vfs.dir_create(args[0]);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `mkdir: ${this.errorMessage_get(error)}`, exitCode: 1 };
        }
    }

    private async touch(args: string[], shell: Shell): Promise<ShellResult> {
        if (args.length === 0) return { stdout: '', stderr: 'touch: missing file operand', exitCode: 1 };
        try {
            this.vfs.file_create(args[0]);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `touch: ${this.errorMessage_get(error)}`, exitCode: 1 };
        }
    }

    private async rm(args: string[], shell: Shell): Promise<ShellResult> {
        const recursive = args.includes('-r') || args.includes('-rf');
        const paths = args.filter(a => !a.startsWith('-'));
        if (paths.length === 0) return { stdout: '', stderr: 'rm: missing operand', exitCode: 1 };
        try {
            for (const p of paths) this.vfs.node_remove(p, recursive);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `rm: ${this.errorMessage_get(error)}`, exitCode: 1 };
        }
    }

    private async cp(args: string[], shell: Shell): Promise<ShellResult> {
        if (args.length < 2) return { stdout: '', stderr: 'cp: missing operand', exitCode: 1 };
        try {
            this.vfs.node_copy(args[0], args[1]);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `cp: ${this.errorMessage_get(error)}`, exitCode: 1 };
        }
    }

    private async mv(args: string[], shell: Shell): Promise<ShellResult> {
        if (args.length < 2) return { stdout: '', stderr: 'mv: missing operand', exitCode: 1 };
        try {
            this.vfs.node_move(args[0], args[1]);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `mv: ${this.errorMessage_get(error)}`, exitCode: 1 };
        }
    }

    private async tree(args: string[], shell: Shell): Promise<ShellResult> {
        const target = args[0] || '.';
        try {
            const resolved = this.vfs.path_resolve(target);
            const root = this.vfs.node_stat(resolved);
            if (!root) return { stdout: '', stderr: `tree: '${target}': No such file or directory`, exitCode: 1 };
            if (root.type !== 'folder') return { stdout: root.name, stderr: '', exitCode: 0 };

            const lines: string[] = [];
            let dirCount = 0;
            let fileCount = 0;

            const subtree_render = (node: FileNode, prefix: string, nodePath: string): void => {
                const children = (node.children || []).slice().sort((a, b) => a.name.localeCompare(b.name));
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    const isLast = i === children.length - 1;
                    const connector = isLast ? '└── ' : '├── ';
                    const name = child.type === 'folder' ? `${child.name}/` : child.name;
                    const childPath = `${nodePath}/${child.name}`;

                    if (child.type === 'file' && child.content === null && child.contentGenerator) {
                        this.vfs.node_read(childPath);
                    }

                    lines.push(`${prefix}${connector}${name}`);

                    if (child.type === 'folder') {
                        dirCount++;
                        const nextPrefix = prefix + (isLast ? '    ' : '│   ');
                        subtree_render(child, nextPrefix, childPath);
                    } else {
                        fileCount++;
                    }
                }
            };

            lines.push(`${root.name}/`);
            dirCount++;
            subtree_render(root, '', resolved);
            lines.push('');
            lines.push(`${dirCount} director${dirCount === 1 ? 'y' : 'ies'}, ${fileCount} file${fileCount === 1 ? '' : 's'}`);

            return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: `tree: ${this.errorMessage_get(error)}`, exitCode: 1 };
        }
    }

    private async env(args: string[], shell: Shell): Promise<ShellResult> {
        const env = shell.env_snapshot();
        const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
        return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
    }

    private async export(args: string[], shell: Shell): Promise<ShellResult> {
        if (args.length === 0) return this.env(args, shell);
        const parts = args[0].split('=');
        if (parts.length !== 2) {
            return { stdout: '', stderr: 'export: invalid format. Use: export KEY=VALUE', exitCode: 1 };
        }
        shell.env_set(parts[0], parts[1]);
        return { stdout: '', stderr: '', exitCode: 0 };
    }

    private async whoami(args: string[], shell: Shell): Promise<ShellResult> {
        return { stdout: shell.env_get('USER') || 'user', stderr: '', exitCode: 0 };
    }

    private async date(args: string[], shell: Shell): Promise<ShellResult> {
        return { stdout: new Date().toString(), stderr: '', exitCode: 0 };
    }

    private async history(args: string[], shell: Shell): Promise<ShellResult> {
        const lines = shell.history_get().map((cmd, i) => `  ${String(i + 1).padStart(4)}  ${cmd}`);
        return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
    }

    private async help(args: string[], shell: Shell): Promise<ShellResult> {
        const commands: string = Object.keys(this.REGISTRY).sort().join(', ');
        return { stdout: `Available commands: ${commands}`, stderr: '', exitCode: 0 };
    }

    private async python(args: string[], shell: Shell): Promise<ShellResult> {
        if (args.length === 0) return { stdout: '', stderr: 'python: missing file operand', exitCode: 1 };
        const scriptPath: string = args[0];
        const resolvedPath: string = this.vfs.path_resolve(scriptPath);
        if (!this.vfs.node_stat(resolvedPath)) {
            return { stdout: '', stderr: `python: can't open file '${scriptPath}': [Errno 2] No such file or directory`, exitCode: 2 };
        }

        try {
            const context: PythonRunContext = this.pythonContext_build(scriptPath, resolvedPath, shell);
            if (context.isChrisValidation) {
                return this.pythonValidation_simulate(context);
            }
            return await this.pythonTraining_simulate(context);
        } catch (error: unknown) {
            return { stdout: '', stderr: this.errorMessage_get(error), exitCode: 1 };
        }
    }

    private async upload(args: string[], shell: Shell): Promise<ShellResult> {
        try {
            if (typeof document === 'undefined') {
                return { stdout: '', stderr: 'upload: Command only available in browser mode.', exitCode: 1 };
            }
            const { files_prompt, files_ingest } = await import('../core/logic/FileUploader.js');
            let destination: string = this.vfs.cwd_get();
            if (args.length > 0) destination = this.vfs.path_resolve(args[0]);

            const files: File[] = await files_prompt();
            if (files.length === 0) return { stdout: '<span class="dim">Upload cancelled.</span>', stderr: '', exitCode: 0 };

            const count: number = await files_ingest(files, destination);
            return { stdout: `<span class="success">Successfully uploaded ${count} file(s) to ${destination}</span>`, stderr: '', exitCode: 0 };
        } catch (error: unknown) {
            return { stdout: '', stderr: this.errorMessage_get(error), exitCode: 1 };
        }
    }

    // ─── Helpers ────────────────────────────────────────────────

    /**
     * Build python execution context from shell/VFS state.
     */
    private pythonContext_build(scriptPath: string, resolvedPath: string, shell: Shell): PythonRunContext {
        this.vfs.node_read(resolvedPath);

        const runRootPath: string = this.projectRoot_resolve(resolvedPath, shell) ?? this.vfs.path_resolve('.');
        const outputDirPath: string = `${runRootPath}/output`;
        const modelPath: string = `${outputDirPath}/model.pth`;
        const statsPath: string = `${outputDirPath}/stats.json`;
        const inputDirPath: string = `${runRootPath}/input`;
        const inputDisplayPath: string = `${this.path_relativeToCwd(inputDirPath, shell)}/`;
        const resolvedLower: string = resolvedPath.toLowerCase();
        const isChrisValidation: boolean = resolvedLower.endsWith('/src/main.py') || resolvedLower.endsWith('/src/app/main.py');

        return {
            scriptPath,
            resolvedPath,
            runRootPath,
            outputDirPath,
            modelPath,
            statsPath,
            inputDisplayPath,
            isChrisValidation
        };
    }

    /**
     * Simulate local ChRIS plugin validation execution.
     */
    private pythonValidation_simulate(context: PythonRunContext): ShellResult {
        let output: string = `<span class="highlight">[LOCAL EXECUTION: ${context.scriptPath}]</span>\n`;
        output += `○ Validating ChRIS plugin entrypoint...\n○ Parsing argument contract and runtime hooks...\n○ Checking input/output filesystem compliance...\n\n--- TEST LOG ---\n[PASS] plugin metadata loaded\n[PASS] argument parser initialized\n[PASS] input/output bindings valid\n\n`;
        this.marker_writeSafe(`${context.runRootPath}/.test_pass`);
        output += `<span class="success">>> LOCAL PLUGIN TEST COMPLETE.</span>\n<span class="dim">   Plugin validation marker saved to: ${context.runRootPath}/.test_pass</span>`;
        return { stdout: output, stderr: '', exitCode: 0 };
    }

    /**
     * Simulate local model training execution and artifact materialization.
     */
    private async pythonTraining_simulate(context: PythonRunContext): Promise<ShellResult> {
        let output: string = `<span class="highlight">[LOCAL EXECUTION: ${context.scriptPath}]</span>\n`;
        output += `○ Loading torch and meridian.data...\n○ Found 1,240 images in ${context.inputDisplayPath}\n○ Model: ResNet50 (Pretrained=True)\n○ Device: NVIDIA A100-SXM4 (Simulated)\n\n--- TRAINING LOG ---\n`;
        output += `Epoch 1/5 [#####---------------] 25% | Loss: 0.8234 | Acc: 0.64\n`;
        await this.delay_wait(200);
        output += `Epoch 2/5 [##########----------] 50% | Loss: 0.5121 | Acc: 0.78\n`;
        output += `Epoch 3/5 [###############-----] 75% | Loss: 0.3245 | Acc: 0.88\n`;
        output += `Epoch 4/5 [###################-] 95% | Loss: 0.2102 | Acc: 0.92\n`;
        output += `Epoch 5/5 [####################] 100% | Loss: 0.1542 | Acc: 0.95\n\n`;

        this.trainingArtifacts_materialize(context);
        output += `<span class="success">>> LOCAL TRAINING COMPLETE.</span>\n<span class="dim">   Model weights saved to: ${context.modelPath}</span>\n<span class="dim">   Validation metrics saved to: ${context.statsPath}</span>`;
        return { stdout: output, stderr: '', exitCode: 0 };
    }

    /**
     * Materialize simulated training artifacts into the project output tree.
     */
    private trainingArtifacts_materialize(context: PythonRunContext): void {
        try {
            this.vfs.dir_create(context.outputDirPath);
            this.vfs.file_create(context.modelPath, 'SIMULATED_PYTORCH_WEIGHTS_BLOB');
            this.vfs.file_create(
                context.statsPath,
                JSON.stringify({ epoch: 5, loss: 0.1542, accuracy: 0.95, status: 'PASS' }, null, 2)
            );
            this.marker_writeSafe(`${context.runRootPath}/.local_pass`);
        } catch {
            // best-effort artifact materialization for simulation mode
        }
    }

    /**
     * Best-effort marker write helper used by simulated python execution.
     */
    private marker_writeSafe(path: string): void {
        try {
            this.vfs.file_create(path, new Date().toISOString());
        } catch {
            // ignore marker write failures in simulation mode
        }
    }

    /**
     * Sleep utility for simulated progress output.
     */
    private async delay_wait(ms: number): Promise<void> {
        await new Promise((resolve: (value: unknown) => void): void => { setTimeout(resolve, ms); });
    }

    /**
     * Resolves the root directory of the current project.
     */
    private projectRoot_resolve(pathHint: string, shell: Shell): string | null {
        const home: string = shell.env_get('HOME') || '/home/user';
        const projectFromEnv: string | undefined = shell.env_get('PROJECT');
        if (projectFromEnv) return `${home}/projects/${projectFromEnv}`;

        const candidates: string[] = [this.vfs.cwd_get(), pathHint];
        const marker: string = '/projects/';

        for (const candidate of candidates) {
            const markerIndex: number = candidate.indexOf(marker);
            if (markerIndex === -1) continue;
            const afterMarker: string = candidate.substring(markerIndex + marker.length);
            const projectName: string = afterMarker.split('/')[0];
            if (!projectName) continue;
            return `${candidate.substring(0, markerIndex + marker.length)}${projectName}`;
        }
        return null;
    }

    /**
     * Converts an absolute path to a relative path from the CWD.
     */
    private path_relativeToCwd(absolutePath: string, shell: Shell): string {
        const cwdParts: string[] = this.vfs.cwd_get().split('/').filter(Boolean);
        const targetParts: string[] = absolutePath.split('/').filter(Boolean);
        let commonIndex: number = 0;
        while (commonIndex < cwdParts.length && commonIndex < targetParts.length && cwdParts[commonIndex] === targetParts[commonIndex]) {
            commonIndex++;
        }
        const upMoves: string[] = Array(cwdParts.length - commonIndex).fill('..');
        const downMoves: string[] = targetParts.slice(commonIndex);
        const relativeParts: string[] = [...upMoves, ...downMoves];
        if (relativeParts.length === 0) return '.';
        const relativePath: string = relativeParts.join('/');
        return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
    }

    /**
     * Convert unknown thrown values into display-safe messages.
     */
    private errorMessage_get(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
