/**
 * @file File Uploader Utility
 * 
 * Handles interaction with the browser's File API to ingest local files
 * into the Virtual Computer System (VCS).
 * 
 * @module
 */

import { globals } from '../state/store.js';

/**
 * Prompts the user to select files from their local device.
 * Returns a Promise that resolves to an array of File objects.
 * 
 * @returns Promise<File[]>
 */
export function files_prompt(): Promise<File[]> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.style.display = 'none'; // Invisible

        input.onchange = () => {
            if (input.files) {
                resolve(Array.from(input.files));
            } else {
                resolve([]);
            }
            input.remove(); // Cleanup
        };

        input.oncancel = () => {
            resolve([]);
            input.remove();
        };

        // Trigger the dialog
        document.body.appendChild(input);
        input.click();
    });
}

/**
 * Reads a File object as text or DataURL depending on type.
 * 
 * @param file - The File to read.
 * @returns Promise<string> containing file content (text or base64 data URI).
 */
function file_read(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        
        // Read binaries as Data URL for preview support
        if (file.type.startsWith('image/') || file.type === 'application/pdf') {
            reader.readAsDataURL(file);
        } else if (file.name.endsWith('.zip') || file.name.endsWith('.dcm')) {
            // Placeholder for unsupported binaries
            resolve(`[BINARY CONTENT: ${file.type} size=${file.size} bytes]`);
        } else {
            // Default to text for code, config, markdown, etc.
            reader.readAsText(file);
        }
    });
}

/**
 * Ingests a list of files into the VCS at the specified directory.
 * 
 * @param files - Array of File objects.
 * @param destination - Absolute path in VCS (e.g. ~/projects/draft/data/uploads).
 * @returns Promise<number> - Number of files successfully written.
 */
export async function files_ingest(files: File[], destination: string): Promise<number> {
    const vcs = globals.vcs;
    if (!vcs) return 0;

    // Ensure destination exists
    try {
        vcs.dir_create(destination);
    } catch {
        // Ignore if exists or parent missing (provider should ensure structure)
    }

    let count = 0;
    for (const file of files) {
        try {
            const content = await file_read(file);
            const path = `${destination}/${file.name}`;
            vcs.file_create(path, content);
            count++;
        } catch (e) {
            console.error(`Failed to ingest ${file.name}:`, e);
        }
    }
    return count;
}
