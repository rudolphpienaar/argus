/**
 * @file FileBrowser — Reusable File Tree + Preview Component
 *
 * Renders a VFS file tree with folder toggle and syntax-highlighted
 * file preview. Designed for reuse across the UI (project detail,
 * process IDE, etc.).
 *
 * All methods follow the RPN naming convention: <subject>_<verb>.
 *
 * @module
 */

import type { FileNode as VcsFileNode } from '../../vfs/types.js';
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { syntax_highlight } from '../syntaxHighlight.js';

// ─── Options Interface ──────────────────────────────────────

/**
 * Configuration for a FileBrowser instance.
 */
export interface FileBrowserOptions {
    /** Container element for the file tree (must contain a `<ul class="interactive-tree">`). */
    treeContainer: HTMLElement;
    /** Container element for file content preview. */
    previewContainer: HTMLElement;
    /** VFS instance for node_read / node_stat. */
    vfs: VirtualFileSystem;
    /** Project base path, e.g. `/home/user/projects/chest-xray`. */
    projectBase: string;
    /** Optional callback when a file is selected. */
    onFileSelect?: (fullPath: string, displayPath: string) => void;
}

// ─── Component Class ────────────────────────────────────────

/**
 * A reusable file tree browser with preview pane.
 *
 * Supports multiple named trees (e.g. 'source', 'data') that can
 * be switched via `tab_switch()`. File clicks read content from
 * the VFS and render syntax-highlighted previews.
 */
export class FileBrowser {
    private treeEl: HTMLElement;
    private previewEl: HTMLElement;
    private vfs: VirtualFileSystem;
    private projectBase: string;
    private trees: Record<string, VcsFileNode> = {};
    private _activeTab: string = '';
    private onFileSelect: ((fullPath: string, displayPath: string) => void) | null;

    constructor(options: FileBrowserOptions) {
        this.treeEl = options.treeContainer;
        this.previewEl = options.previewContainer;
        this.vfs = options.vfs;
        this.projectBase = options.projectBase;
        this.onFileSelect = options.onFileSelect || null;
    }

    // ─── Public API ─────────────────────────────────────────

    /**
     * Sets the available tree roots keyed by tab ID.
     * Does not render; call `tree_render()` afterward.
     */
    public trees_set(trees: Record<string, VcsFileNode>): void {
        this.trees = trees;
        const keys: string[] = Object.keys(trees);
        if (keys.length > 0 && !this._activeTab) {
            this._activeTab = keys[0];
        }
    }

    /**
     * Switches to the given tab and re-renders the tree.
     */
    public tab_switch(tabId: string): void {
        if (this.trees[tabId]) {
            this._activeTab = tabId;
            this.tree_render();
        }
    }

    /**
     * Renders the active tab's tree into the tree container.
     * Clears the preview pane and re-attaches click handlers.
     */
    public tree_render(): void {
        const root: VcsFileNode | undefined = this.trees[this._activeTab];
        if (!root) return;

        const treeUl: Element | null = this.treeEl.querySelector('.interactive-tree');
        if (treeUl) {
            treeUl.innerHTML = this.node_render(root);
        }

        // Clear preview when switching tabs
        this.previewEl.innerHTML = '<p class="dim">Select a file to preview</p>';

        // Replace the tree element to clear old event listeners
        const freshTree: HTMLElement = this.treeEl.cloneNode(true) as HTMLElement;
        this.treeEl.parentNode?.replaceChild(freshTree, this.treeEl);
        freshTree.id = this.treeEl.id;
        this.treeEl = freshTree;
        this.handlers_attach();
    }

    /**
     * Previews a file in the preview pane. Image files are rendered
     * as `<img>` tags using web-served paths; text files are read
     * from VFS with syntax highlighting.
     *
     * @param fullPath - Absolute VFS path to the file.
     * @param displayPath - Path shown in the preview header.
     */
    public preview_show(fullPath: string, displayPath: string): void {
        const fileName: string = displayPath.split('/').pop() || displayPath;

        // Image files — render from web-served dataset images
        if (this.imageFile_test(fileName)) {
            const webUrl: string | null = this.imageWebUrl_resolve(fullPath, fileName);
            if (webUrl) {
                this.previewEl.innerHTML = `
                    <div class="preview-filename">${fileName}</div>
                    <img src="${webUrl}" alt="${fileName}" onerror="this.outerHTML='<pre><code><span class=dim>Image not found on server</span></code></pre>'">
                `;
                return;
            }
        }

        // Text files — read content from VFS
        try {
            const content: string | null = this.vfs.node_read(fullPath);
            if (content != null) {
                this.previewEl.innerHTML = `
                    <div class="preview-filename">${fileName}</div>
                    <div class="code-content"><pre>${syntax_highlight(content, fileName)}</pre></div>
                `;
                return;
            }
        } catch {
            // Fall through to placeholder
        }

        this.previewEl.innerHTML = `
            <div class="preview-filename">${fileName}</div>
            <div class="code-content"><pre><span class="dim">No content available</span></pre></div>
        `;
    }

    /**
     * Returns the currently active tab ID.
     */
    public activeTab_get(): string {
        return this._activeTab;
    }

    /**
     * Cleans up DOM references to prevent memory leaks.
     */
    public destroy(): void {
        this.treeEl.innerHTML = '';
        this.previewEl.innerHTML = '';
        this.trees = {};
        this.onFileSelect = null;
    }

    // ─── Private Helpers ────────────────────────────────────

    /**
     * Recursively renders a VFS FileNode as nested `<li>` HTML.
     */
    private node_render(n: VcsFileNode): string {
        if (n.children) {
            return `<li class="${n.type} open" data-path="${n.path}">
                        <span class="tree-toggle">${n.name}</span>
                        <ul>${n.children.map((c: VcsFileNode): string => this.node_render(c)).join('')}</ul>
                    </li>`;
        }
        return `<li class="${n.type}" data-path="${n.path}">${n.name} <span class="dim" style="float:right">${n.size}</span></li>`;
    }

    /**
     * Attaches click handlers to the tree via event delegation.
     * Folders toggle open/closed; files trigger preview.
     */
    private handlers_attach(): void {
        this.treeEl.addEventListener('click', (e: Event): void => {
            const target: HTMLElement = (e.target as HTMLElement).closest('li') as HTMLElement;
            if (!target) return;

            // Folder toggle
            if (target.classList.contains('folder')) {
                target.classList.toggle('open');
                e.stopPropagation();
                return;
            }

            // File preview
            if (target.classList.contains('file')) {
                e.stopPropagation();
                // Mark selected
                this.treeEl.querySelectorAll('.file.selected').forEach(
                    (el: Element): void => el.classList.remove('selected')
                );
                target.classList.add('selected');

                const nodePath: string | undefined = target.dataset.path;
                if (!nodePath) return;

                const fullPath: string = this.path_resolve(nodePath);
                this.preview_show(fullPath, nodePath);
                if (this.onFileSelect) {
                    this.onFileSelect(fullPath, nodePath);
                }
            }
        });
    }

    /**
     * Resolves a node path to an absolute VFS path.
     * After tree_mount, data paths are already absolute (/home/...).
     * Source paths are relative (/src/...) and need the project base.
     */
    private path_resolve(nodePath: string): string {
        if (nodePath.startsWith('/home/')) {
            return nodePath;
        }
        return `${this.projectBase}${nodePath.startsWith('/') ? nodePath : '/' + nodePath}`;
    }

    /**
     * Returns true if the filename has an image extension.
     */
    private imageFile_test(fileName: string): boolean {
        return /\.(jpg|jpeg|png|bmp|gif)$/i.test(fileName);
    }

    /**
     * Resolves a web-servable URL for an image by looking up
     * `imageWebBase` metadata on the parent images/ folder.
     */
    private imageWebUrl_resolve(fullPath: string, fileName: string): string | null {
        const parentPath: string = fullPath.substring(0, fullPath.lastIndexOf('/'));
        try {
            const parentNode = this.vfs.node_stat(parentPath);
            if (parentNode && parentNode.metadata && parentNode.metadata.imageWebBase) {
                return `${parentNode.metadata.imageWebBase}/${fileName}`;
            }
        } catch {
            // Parent not found
        }
        return null;
    }
}
