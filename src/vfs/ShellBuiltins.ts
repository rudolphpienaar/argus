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
        'upload': this.upload.bind(this),
        'analyze': this.analyze.bind(this),
        'simulate': this.simulate.bind(this),
        'harmonize': this.harmonize.bind(this)
    };

    private async cd(args: string[], shell: Shell): Promise<ShellResult> {
        const target = args[0] || shell.env_get('HOME') || '/';
        try {
            this.vfs.cwd_set(target);
            const newCwd = this.vfs.cwd_get();
            shell.env_set('PWD', newCwd);
            shell.cwd_didChange(newCwd);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (e: any) {
            return { stdout: '', stderr: `cd: ${e.message}`, exitCode: 1 };
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
        } catch (e: any) {
            return { stdout: '', stderr: `ls: ${e.message}`, exitCode: 1 };
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
        } catch (e: any) {
            return { stdout: '', stderr: `cat: ${e.message}`, exitCode: 1 };
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
        } catch (e: any) {
            return { stdout: '', stderr: `mkdir: ${e.message}`, exitCode: 1 };
        }
    }

    private async touch(args: string[], shell: Shell): Promise<ShellResult> {
        if (args.length === 0) return { stdout: '', stderr: 'touch: missing file operand', exitCode: 1 };
        try {
            this.vfs.file_create(args[0]);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (e: any) {
            return { stdout: '', stderr: `touch: ${e.message}`, exitCode: 1 };
        }
    }

    private async rm(args: string[], shell: Shell): Promise<ShellResult> {
        const recursive = args.includes('-r') || args.includes('-rf');
        const paths = args.filter(a => !a.startsWith('-'));
        if (paths.length === 0) return { stdout: '', stderr: 'rm: missing operand', exitCode: 1 };
        try {
            for (const p of paths) this.vfs.node_remove(p, recursive);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (e: any) {
            return { stdout: '', stderr: `rm: ${e.message}`, exitCode: 1 };
        }
    }

    private async cp(args: string[], shell: Shell): Promise<ShellResult> {
        if (args.length < 2) return { stdout: '', stderr: 'cp: missing operand', exitCode: 1 };
        try {
            this.vfs.node_copy(args[0], args[1]);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (e: any) {
            return { stdout: '', stderr: `cp: ${e.message}`, exitCode: 1 };
        }
    }

    private async mv(args: string[], shell: Shell): Promise<ShellResult> {
        if (args.length < 2) return { stdout: '', stderr: 'mv: missing operand', exitCode: 1 };
        try {
            this.vfs.node_move(args[0], args[1]);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (e: any) {
            return { stdout: '', stderr: `mv: ${e.message}`, exitCode: 1 };
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
        } catch (e: any) {
            return { stdout: '', stderr: `tree: ${e.message}`, exitCode: 1 };
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
        const commands = Object.keys(this.REGISTRY).sort().join(', ');
        return { stdout: `Available commands: ${commands}`, stderr: '', exitCode: 0 };
    }

    private async python(args: string[], shell: Shell): Promise<ShellResult> {
        if (args.length === 0) return { stdout: '', stderr: 'python: missing file operand', exitCode: 1 };
        const scriptPath = args[0];
        try {
            const resolved = this.vfs.path_resolve(scriptPath);
            if (!this.vfs.node_stat(resolved)) {
                return { stdout: '', stderr: `python: can't open file '${scriptPath}': [Errno 2] No such file or directory`, exitCode: 2 };
            }
            this.vfs.node_read(resolved);

            const runRootPath = this.projectRoot_resolve(resolved, shell) ?? this.vfs.path_resolve('.');
            const outputDirPath = `${runRootPath}/output`;
            const modelPath = `${outputDirPath}/model.pth`;
            const statsPath = `${outputDirPath}/stats.json`;
            const inputDirPath = `${runRootPath}/input`;
            const inputDisplayPath = `${this.path_relativeToCwd(inputDirPath)}/`;
            const resolvedLower = resolved.toLowerCase();
            const isChrisValidation = resolvedLower.endsWith('/src/main.py') || resolvedLower.endsWith('/src/app/main.py');

            if (isChrisValidation) {
                let output = `<span class="highlight">[LOCAL EXECUTION: ${scriptPath}]</span>\n`;
                output += `○ Validating ChRIS plugin entrypoint...\n○ Parsing argument contract and runtime hooks...\n○ Checking input/output filesystem compliance...\n\n--- TEST LOG ---\n[PASS] plugin metadata loaded\n[PASS] argument parser initialized\n[PASS] input/output bindings valid\n\n`;
                try {
                    this.vfs.file_create(`${runRootPath}/.test_pass`, new Date().toISOString());
                } catch { /* ignore */ }
                output += `<span class="success">>> LOCAL PLUGIN TEST COMPLETE.</span>\n<span class="dim">   Plugin validation marker saved to: ${runRootPath}/.test_pass</span>`;
                return { stdout: output, stderr: '', exitCode: 0 };
            }

            let output = `<span class="highlight">[LOCAL EXECUTION: ${scriptPath}]</span>\n`;
            output += `○ Loading torch and meridian.data...\n○ Found 1,240 images in ${inputDisplayPath}\n○ Model: ResNet50 (Pretrained=True)\n○ Device: NVIDIA A100-SXM4 (Simulated)\n\n--- TRAINING LOG ---\n`;
            output += `Epoch 1/5 [#####---------------] 25% | Loss: 0.8234 | Acc: 0.64\n`;
            await new Promise(r => setTimeout(r, 200));
            output += `Epoch 2/5 [##########----------] 50% | Loss: 0.5121 | Acc: 0.78\n`;
            output += `Epoch 3/5 [###############-----] 75% | Loss: 0.3245 | Acc: 0.88\n`;
            output += `Epoch 4/5 [###################-] 95% | Loss: 0.2102 | Acc: 0.92\n`;
            output += `Epoch 5/5 [####################] 100% | Loss: 0.1542 | Acc: 0.95\n\n`;

            // Materialize artifacts in VFS so CLI output matches filesystem state.
            try {
                this.vfs.dir_create(outputDirPath);
                this.vfs.file_create(modelPath, 'SIMULATED_PYTORCH_WEIGHTS_BLOB');
                this.vfs.file_create(statsPath, JSON.stringify({ epoch: 5, loss: 0.1542, accuracy: 0.95, status: 'PASS' }, null, 2));
                
                // CRITICAL: Materialize .local_pass marker at project root
                this.vfs.file_create(`${runRootPath}/.local_pass`, new Date().toISOString());
            } catch { /* ignore */ }

            output += `<span class="success">>> LOCAL TRAINING COMPLETE.</span>\n<span class="dim">   Model weights saved to: ${modelPath}</span>\n<span class="dim">   Validation metrics saved to: ${statsPath}</span>`;
            return { stdout: output, stderr: '', exitCode: 0 };
        } catch (e: any) {
            return { stdout: '', stderr: e.message, exitCode: 1 };
        }
    }

    private async upload(args: string[], shell: Shell): Promise<ShellResult> {
        try {
            if (typeof document === 'undefined') {
                return { stdout: '', stderr: 'upload: Command only available in browser mode.', exitCode: 1 };
            }
            const { files_prompt, files_ingest } = await import('../core/logic/FileUploader.js');
            let destination = this.vfs.cwd_get();
            if (args.length > 0) destination = this.vfs.path_resolve(args[0]);

            const files = await files_prompt();
            if (files.length === 0) return { stdout: '<span class="dim">Upload cancelled.</span>', stderr: '', exitCode: 0 };

            const count = await files_ingest(files, destination);
            return { stdout: `<span class="success">Successfully uploaded ${count} file(s) to ${destination}</span>`, stderr: '', exitCode: 0 };
        } catch (e: any) {
            return { stdout: '', stderr: e.message, exitCode: 1 };
        }
    }

    private async analyze(args: string[], shell: Shell): Promise<ShellResult> {
        if (args[0] !== 'cohort') return { stdout: '', stderr: 'Usage: analyze cohort', exitCode: 1 };
        const project = shell.env_get('PROJECT');
        if (!project) return { stdout: '', stderr: 'analyze: No active project context ($PROJECT not set)', exitCode: 1 };

        try {
            const { cohort_analyze } = await import('../core/analysis/CohortProfiler.js');
            // Assuming shell has username logic or we get it from env
            const user = shell.env_get('USER') || 'user';
            const report = cohort_analyze(this.vfs, `/home/${user}/projects/${project}/input`);
            return { stdout: report, stderr: '', exitCode: 0 };
        } catch (e: any) {
            return { stdout: '', stderr: e.message, exitCode: 1 };
        }
    }

    private async simulate(args: string[], shell: Shell): Promise<ShellResult> {
        if (args[0] !== 'federation') return { stdout: '', stderr: 'Usage: simulate federation', exitCode: 1 };
        const project = shell.env_get('PROJECT');
        if (!project) return { stdout: '', stderr: 'simulate: No active project context ($PROJECT not set)', exitCode: 1 };

        try {
            const { federation_simulate } = await import('../core/simulation/PhantomFederation.js');
            const user = shell.env_get('USER') || 'user';
            const projectPath = `/home/${user}/projects/${project}`;
            
            if (!this.vfs.node_stat(`${projectPath}/.local_pass`)) {
                return { stdout: '', stderr: `simulate: Local validation required. Run "python train.py" first.`, exitCode: 1 };
            }

            const result = await federation_simulate(this.vfs, projectPath);
            const output = result.logs.map(l => {
                if (l.startsWith('ERROR')) return `<span class="error">${l}</span>`;
                if (l.startsWith('>>')) return `<span class="highlight">${l}</span>`;
                return `<span class="dim">${l}</span>`;
            }).join('\n');

            if (result.success) {
                return { stdout: output + '\n<span class="success">SIMULATION COMPLETE. FEDERALIZATION UNLOCKED.</span>', stderr: '', exitCode: 0 };
            } else {
                return { stdout: '', stderr: output, exitCode: 1 };
            }
        } catch (e: any) {
            return { stdout: '', stderr: e.message, exitCode: 1 };
        }
    }

    private async harmonize(args: string[], shell: Shell): Promise<ShellResult> {
        if (args[0] !== 'cohort') return { stdout: '', stderr: 'Usage: harmonize cohort', exitCode: 1 };
        const project = shell.env_get('PROJECT');
        if (!project) return { stdout: '', stderr: 'harmonize: No active project context ($PROJECT not set)', exitCode: 1 };

        try {
            const { MOCK_PROJECTS } = await import('../core/data/projects.js');
            const { project_harmonize } = await import('../core/logic/ProjectManager.js');
            const model = MOCK_PROJECTS.find(p => p.name === project);
            if (!model) return { stdout: '', stderr: 'harmonize: Project model not found', exitCode: 1 };

            project_harmonize(model);
            return { stdout: '', stderr: '', exitCode: 0 };
        } catch (e: any) {
            return { stdout: '', stderr: e.message, exitCode: 1 };
        }
    }

    // ─── Helpers ────────────────────────────────────────────────

    private projectRoot_resolve(pathHint: string, shell: Shell): string | null {
        const home = shell.env_get('HOME') || '/home/user';
        const projectFromEnv = shell.env_get('PROJECT');
        if (projectFromEnv) return `${home}/projects/${projectFromEnv}`;

        const candidates = [this.vfs.cwd_get(), pathHint];
        const marker = '/projects/';

        for (const candidate of candidates) {
            const markerIndex = candidate.indexOf(marker);
            if (markerIndex === -1) continue;
            const afterMarker = candidate.substring(markerIndex + marker.length);
            const projectName = afterMarker.split('/')[0];
            if (!projectName) continue;
            return `${candidate.substring(0, markerIndex + marker.length)}${projectName}`;
        }
        return null;
    }

    private path_relativeToCwd(absolutePath: string): string {
        const cwdParts = this.vfs.cwd_get().split('/').filter(Boolean);
        const targetParts = absolutePath.split('/').filter(Boolean);
        let commonIndex = 0;
        while (commonIndex < cwdParts.length && commonIndex < targetParts.length && cwdParts[commonIndex] === targetParts[commonIndex]) {
            commonIndex++;
        }
        const upMoves = Array(cwdParts.length - commonIndex).fill('..');
        const downMoves = targetParts.slice(commonIndex);
        const relativeParts = [...upMoves, ...downMoves];
        if (relativeParts.length === 0) return '.';
        const relativePath = relativeParts.join('/');
        return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
    }
}
