/**
 * @file Gather Workspace Path Mapping
 *
 * Pure mapping helpers between shell CWD and Gather-stage UI tabs.
 *
 * This module exists to keep path-to-tab semantics centralized and explicit
 * so terminal navigation and FileBrowser tab state stay synchronized.
 *
 * @module core/stages/gather/utils/workspacePaths
 */

/**
 * Resolve a sidebar tab ID from a project-scoped CWD.
 *
 * @param cwd - Absolute current working directory from Shell/VFS.
 * @param workspaceProjectBase - Active project root used by workspace mode.
 * @returns `'source'`, `'input'`, or `null` if no tab mapping exists.
 */
export function workspaceTab_resolveFromCwd(
    cwd: string,
    workspaceProjectBase: string,
): string | null {
    if (!workspaceProjectBase) {
        return null;
    }

    const relative: string = cwd.startsWith(workspaceProjectBase)
        ? cwd.substring(workspaceProjectBase.length)
        : '';

    if (relative === '/src' || relative.startsWith('/src/')) {
        return 'source';
    }
    if (relative === '/input' || relative.startsWith('/input/')) {
        return 'input';
    }
    if (relative === '/data' || relative.startsWith('/data/')) {
        return 'input';
    }
    return null;
}
