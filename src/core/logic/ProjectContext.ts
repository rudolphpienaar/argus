/**
 * @file Project Context Utility
 *
 * Centralizes logic for resolving project filesystem paths.
 * Ensures consistent pathing across Search, Process, and Shell modules.
 *
 * @module
 */

import { globals } from '../state/store.js';
import type { Project } from '../models/types.js';

export interface ProjectPaths {
    root: string;
    src: string;
    input: string;
    output: string;
}

/**
 * Resolves the standard VFS paths for a given project based on the current user.
 *
 * @param project - The project to resolve paths for.
 * @returns Object containing absolute paths for root, src, input, output.
 */
export function projectContext_get(project: Project): ProjectPaths {
    const username = globals.shell?.env_get('USER') || 'user';
    const root = `/home/${username}/projects/${project.name}`;
    
    return {
        root,
        src: `${root}/src`,
        input: `${root}/input`,
        output: `${root}/output`
    };
}
