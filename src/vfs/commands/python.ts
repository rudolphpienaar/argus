import type { BuiltinCommand } from './types.js';
import type { Shell } from '../Shell.js';
import type { VirtualFileSystem } from '../VirtualFileSystem.js';
import { errorMessage_get } from './_shared.js';

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

export const command: BuiltinCommand = {
    name: 'python',
    create: ({ vfs }) => async (args, shell) => {
        if (args.length === 0) {
            return { stdout: '', stderr: 'python: missing file operand', exitCode: 1 };
        }

        const scriptPath: string = args[0];
        const resolvedPath: string = vfs.path_resolve(scriptPath);
        if (!vfs.node_stat(resolvedPath)) {
            return {
                stdout: '',
                stderr: `python: can't open file '${scriptPath}': [Errno 2] No such file or directory`,
                exitCode: 2
            };
        }

        try {
            const context: PythonRunContext = pythonContext_build(vfs, scriptPath, resolvedPath, shell);
            if (context.isChrisValidation) {
                return pythonValidation_run(vfs, context);
            }
            return await pythonTraining_run(vfs, context);
        } catch (error: unknown) {
            return { stdout: '', stderr: errorMessage_get(error), exitCode: 1 };
        }
    }
};

function pythonContext_build(
vfs: VirtualFileSystem,
scriptPath: string,
resolvedPath: string,
shell: Shell): PythonRunContext {
    vfs.node_read(resolvedPath);

    const runRootPath: string = projectRoot_resolve(vfs, resolvedPath, shell) ?? vfs.path_resolve('.');
    const outputDirPath: string = `${runRootPath}/output`;
    const modelPath: string = `${outputDirPath}/model.pth`;
    const statsPath: string = `${outputDirPath}/stats.json`;
    const inputDirPath: string = `${runRootPath}/input`;
    const inputDisplayPath: string = `${path_relativeToCwd(vfs, inputDirPath)}/`;
    const resolvedLower: string = resolvedPath.toLowerCase();
    const isChrisValidation: boolean =
        resolvedLower.endsWith('/src/main.py') || resolvedLower.endsWith('/src/app/main.py');

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

function pythonValidation_run(vfs: VirtualFileSystem, context: PythonRunContext) {
    let output: string = `<span class="highlight">[LOCAL EXECUTION: ${context.scriptPath}]</span>\n`;
    output += '○ Validating ChRIS plugin entrypoint...\n○ Parsing argument contract and runtime hooks...\n○ Checking input/output filesystem compliance...\n\n--- TEST LOG ---\n[PASS] plugin metadata loaded\n[PASS] argument parser initialized\n[PASS] input/output bindings valid\n\n';
    marker_writeSafe(vfs, `${context.runRootPath}/.test_pass`);
    output += `<span class="success">>> LOCAL PLUGIN TEST COMPLETE.</span>\n<span class="dim">   Plugin validation marker saved to: ${context.runRootPath}/.test_pass</span>`;
    return { stdout: output, stderr: '', exitCode: 0 };
}

async function pythonTraining_run(vfs: VirtualFileSystem, context: PythonRunContext) {
    let output: string = `<span class="highlight">[LOCAL EXECUTION: ${context.scriptPath}]</span>\n`;
    output += `○ Loading torch and meridian.data...\n○ Found 1,240 images in ${context.inputDisplayPath}\n○ Model: ResNet50 (Pretrained=True)\n○ Device: NVIDIA A100-SXM4\n\n--- TRAINING LOG ---\n`;
    output += 'Epoch 1/5 [#####---------------] 25% | Loss: 0.8234 | Acc: 0.64\n';
    output += 'Epoch 2/5 [##########----------] 50% | Loss: 0.5121 | Acc: 0.78\n';
    output += 'Epoch 3/5 [###############-----] 75% | Loss: 0.3245 | Acc: 0.88\n';
    output += 'Epoch 4/5 [###################-] 95% | Loss: 0.2102 | Acc: 0.92\n';
    output += 'Epoch 5/5 [####################] 100% | Loss: 0.1542 | Acc: 0.95\n\n';

    trainingArtifacts_materialize(vfs, context);
    output += `<span class="success">>> LOCAL TRAINING COMPLETE.</span>\n<span class="dim">   Model weights saved to: ${context.modelPath}</span>\n<span class="dim">   Validation metrics saved to: ${context.statsPath}</span>`;
    return { stdout: output, stderr: '', exitCode: 0 };
}

function trainingArtifacts_materialize(vfs: VirtualFileSystem, context: PythonRunContext): void {
    try {
        vfs.dir_create(context.outputDirPath);
        vfs.file_create(context.modelPath, 'PYTORCH_WEIGHTS_BLOB');
        vfs.file_create(
            context.statsPath,
            JSON.stringify({ epoch: 5, loss: 0.1542, accuracy: 0.95, status: 'PASS' }, null, 2)
        );
        marker_writeSafe(vfs, `${context.runRootPath}/.local_pass`);
    } catch {
        // best-effort artifact materialization
    }
}

function marker_writeSafe(vfs: VirtualFileSystem, path: string): void {
    try {
        vfs.file_create(path, new Date().toISOString());
    } catch {
        // ignore marker write failures
    }
}

function projectRoot_resolve(vfs: VirtualFileSystem, pathHint: string, shell: Shell): string | null {
    const dataDirFromEnv: string | undefined = shell.env_get('DATA_DIR');
    if (dataDirFromEnv) {
        return dataDirFromEnv;
    }

    const home: string = shell.env_get('HOME') || '/home/user';
    const projectFromEnv: string | undefined = shell.env_get('PROJECT');
    if (projectFromEnv) {
        return `${home}/projects/${projectFromEnv}`;
    }

    const candidates: string[] = [vfs.cwd_get(), pathHint];
    const marker: string = '/projects/';

    for (const candidate of candidates) {
        const markerIndex: number = candidate.indexOf(marker);
        if (markerIndex === -1) {
            continue;
        }

        const afterMarker: string = candidate.substring(markerIndex + marker.length);
        const projectName: string = afterMarker.split('/')[0];
        if (!projectName) {
            continue;
        }

        return `${candidate.substring(0, markerIndex + marker.length)}${projectName}`;
    }
    return null;
}

function path_relativeToCwd(vfs: VirtualFileSystem, absolutePath: string): string {
    const cwdParts: string[] = vfs.cwd_get().split('/').filter(Boolean);
    const targetParts: string[] = absolutePath.split('/').filter(Boolean);

    let commonIndex = 0;
    while (
        commonIndex < cwdParts.length
        && commonIndex < targetParts.length
        && cwdParts[commonIndex] === targetParts[commonIndex]
    ) {
        commonIndex += 1;
    }

    const upMoves: string[] = Array(cwdParts.length - commonIndex).fill('..');
    const downMoves: string[] = targetParts.slice(commonIndex);
    const relativeParts: string[] = [...upMoves, ...downMoves];
    if (relativeParts.length === 0) {
        return '.';
    }

    const relativePath: string = relativeParts.join('/');
    return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}
