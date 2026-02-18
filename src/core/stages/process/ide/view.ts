/**
 * @file Process IDE View Orchestration
 *
 * Renders and controls the Process-stage FileBrowser + code preview surface.
 *
 * @module core/stages/process/ide/view
 */

import { store } from '../../../state/store.js';
import { FileBrowser } from '../../../../ui/components/FileBrowser.js';
import { processStage_state } from '../runtime/state.js';
import { ideTree_build } from './tree.js';

interface IdeElements {
    treeContainer: HTMLElement | null;
    previewContainer: HTMLElement | null;
}

/**
 * Populate the Process-stage IDE file tree and preview pane.
 */
export function populate_ide(): void {
    const elements: IdeElements = ideElements_resolve();
    if (!elements.treeContainer) {
        return;
    }

    const viewRootPath: string = ideRootPath_resolve();
    const hasRoot: boolean = store.globals.vcs.node_stat(viewRootPath) !== null;
    if (!elements.previewContainer || !hasRoot) {
        ideEmpty_render(elements.treeContainer);
        return;
    }

    ideTreeContainer_ensure(elements.treeContainer);
    ideBrowser_reset();

    const browser: FileBrowser = ideBrowser_create(elements.treeContainer, elements.previewContainer, viewRootPath);
    processStage_state.ideBrowser = browser;

    ideTree_render(browser, viewRootPath);
    ideDefaultFile_open(browser, viewRootPath);
}

/**
 * Open a file in the Process-stage IDE preview pane.
 *
 * @param filename - File name relative to current working directory.
 * @param _type - Compatibility placeholder (unused).
 */
export function ide_openFile(filename: string, _type: string): void {
    const browser: FileBrowser | null = processStage_state.ideBrowser;
    if (!browser) {
        return;
    }

    const cwdPath: string = store.globals.vcs.cwd_get();
    browser.preview_show(`${cwdPath}/${filename}`, filename);
}

/**
 * Resolve Process-stage IDE DOM elements.
 */
function ideElements_resolve(): IdeElements {
    return {
        treeContainer: document.getElementById('process-file-tree'),
        previewContainer: document.getElementById('process-code-content'),
    };
}

/**
 * Resolve the Process-stage tree root path.
 */
function ideRootPath_resolve(): string {
    const projectName: string | undefined = store.globals.shell?.env_get('PROJECT');
    if (projectName) {
        const username: string = store.globals.shell?.env_get('USER') || 'user';
        return `/home/${username}/projects/${projectName}`;
    }
    return store.globals.vcs.cwd_get();
}

/**
 * Render an empty-state tree message.
 */
function ideEmpty_render(treeContainer: HTMLElement): void {
    treeContainer.innerHTML = '<span class="dim">No filesystem mounted.</span>';
}

/**
 * Ensure tree container has the interactive root list element.
 */
function ideTreeContainer_ensure(treeContainer: HTMLElement): void {
    if (!treeContainer.querySelector('.interactive-tree')) {
        treeContainer.innerHTML = '<ul class="interactive-tree"></ul>';
    }
}

/**
 * Destroy and clear any previous IDE browser instance.
 */
function ideBrowser_reset(): void {
    if (!processStage_state.ideBrowser) {
        return;
    }
    processStage_state.ideBrowser.destroy();
    processStage_state.ideBrowser = null;
}

/**
 * Create a new FileBrowser instance for Process-stage IDE.
 */
function ideBrowser_create(
    treeContainer: HTMLElement,
    previewContainer: HTMLElement,
    projectBase: string,
): FileBrowser {
    return new FileBrowser({
        treeContainer,
        previewContainer,
        vfs: store.globals.vcs,
        projectBase,
    });
}

/**
 * Render full recursive IDE tree.
 */
function ideTree_render(browser: FileBrowser, viewRootPath: string): void {
    const fullTree = ideTree_build(viewRootPath);
    if (!fullTree) {
        return;
    }
    browser.trees_set({ default: fullTree });
    browser.tree_render();
}

/**
 * Open the first available default file for developer context.
 */
function ideDefaultFile_open(browser: FileBrowser, viewRootPath: string): void {
    const defaultFiles: readonly string[] = ['src/train.py', 'train.py', 'README.md'];
    for (const relativePath of defaultFiles) {
        const fullPath: string = `${viewRootPath}/${relativePath}`;
        if (store.globals.vcs.node_stat(fullPath)) {
            browser.preview_show(fullPath, relativePath);
            return;
        }
    }
}
