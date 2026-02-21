import type { BuiltinCommand } from './types.js';
import { errorMessage_get } from './_shared.js';

export const command: BuiltinCommand = {
    name: 'upload',
    create: ({ vfs }) => async (args) => {
        try {
            if (typeof document === 'undefined') {
                return { stdout: '', stderr: 'upload: Command only available in browser mode.', exitCode: 1 };
            }

            const { files_prompt, files_ingest } = await import('../../core/logic/FileUploader.js');
            let destination: string = vfs.cwd_get();
            if (args.length > 0) {
                destination = vfs.path_resolve(args[0]);
            }

            const files: File[] = await files_prompt();
            if (files.length === 0) {
                return { stdout: '<span class="dim">Upload cancelled.</span>', stderr: '', exitCode: 0 };
            }

            const count: number = await files_ingest(files, destination);
            return {
                stdout: `<span class="success">Successfully uploaded ${count} file(s) to ${destination}</span>`,
                stderr: '',
                exitCode: 0
            };
        } catch (error: unknown) {
            return { stdout: '', stderr: errorMessage_get(error), exitCode: 1 };
        }
    }
};
