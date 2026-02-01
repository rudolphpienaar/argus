/**
 * @file FileBrowser — Reusable File Tree + Preview Component
 *
 * Renders a VFS file tree with folder toggle and syntax-highlighted
 * file preview. Designed for reuse across the UI (project detail,
 * process IDE, etc.).
 *
 * Supports an optional **selectable mode** for granular file/folder
 * gathering. In selectable mode, long-pressing a file toggles its
 * selection; long-pressing a folder toggles the folder and all its
 * descendant files. Selected items are visually marked and can be
 * extracted as a pruned subtree.
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
    /** Optional callback when a file is selected (short click). */
    onFileSelect?: (fullPath: string, displayPath: string) => void;
    /** Enable long-press selection mode for gathering. */
    selectable?: boolean;
    /** Called whenever the selection set changes (selectable mode only). */
    onSelectionChange?: (selectedPaths: string[]) => void;
}

// ─── Constants ──────────────────────────────────────────────

/** Duration in ms a press must be held to trigger selection. */
const LONG_PRESS_MS: number = 500;

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

    // ─── Selectable mode state ──────────────────────────────
    private selectable: boolean;
    private onSelectionChange: ((selectedPaths: string[]) => void) | null;
    private selectedPaths: Set<string> = new Set();
    private longPressTimer: ReturnType<typeof setTimeout> | null = null;
    private longPressFired: boolean = false;

    constructor(options: FileBrowserOptions) {
        this.treeEl = options.treeContainer;
        this.previewEl = options.previewContainer;
        this.vfs = options.vfs;
        this.projectBase = options.projectBase;
        this.onFileSelect = options.onFileSelect || null;
        this.selectable = options.selectable || false;
        this.onSelectionChange = options.onSelectionChange || null;
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

        try {
            const content: string | null = this.vfs.node_read(fullPath);
            
            // Handle Data URIs (uploaded files)
            if (content && content.startsWith('data:')) {
                if (content.startsWith('data:image/')) {
                    this.previewEl.innerHTML = `
                        <div class="preview-filename">${fileName}</div>
                        <img src="${content}" alt="${fileName}" style="max-height: 100%; max-width: 100%; object-fit: contain;">
                    `;
                    return;
                }
                if (content.startsWith('data:application/pdf')) {
                    this.previewEl.innerHTML = `
                        <div class="preview-filename">${fileName}</div>
                        <embed src="${content}" type="application/pdf" width="100%" height="100%" style="min-height: 500px; border: none;">
                    `;
                    return;
                }
            }

            // Image files from web server (legacy path)
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

            // Text files
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
     * Returns the list of currently selected file paths (selectable mode).
     */
    public selection_get(): string[] {
        return Array.from(this.selectedPaths);
    }

    /**
     * Clears all selections and updates the visual state.
     */
    public selection_clear(): void {
        this.selectedPaths.clear();
        this.treeEl.querySelectorAll('.selected-for-gather').forEach(
            (el: Element): void => el.classList.remove('selected-for-gather')
        );
        this.selectionChange_notify();
    }

    /**
     * Extracts a pruned copy of the given tree containing only
     * selected files and the directory skeleton needed to reach them.
     * Returns null if nothing is selected under this root.
     */
    public selectionSubtree_extract(root: VcsFileNode): VcsFileNode | null {
        return this.subtree_prune(root);
    }

    /**
     * Cleans up DOM references to prevent memory leaks.
     */
    public destroy(): void {
        this.longPress_cancel();
        this.treeEl.innerHTML = '';
        this.previewEl.innerHTML = '';
        this.trees = {};
        this.selectedPaths.clear();
        this.onFileSelect = null;
        this.onSelectionChange = null;
    }

    // ─── Private: Tree Rendering ────────────────────────────

    /**
     * Recursively renders a VFS FileNode as nested `<li>` HTML.
     */
    private node_render(n: VcsFileNode): string {
        const gatherClass: string = this.selectedPaths.has(n.path) ? ' selected-for-gather' : '';

        if (n.children) {
            return `<li class="${n.type} open${gatherClass}" data-path="${n.path}">
                        <span class="tree-toggle">${n.name}</span>
                        <ul>${n.children.map((c: VcsFileNode): string => this.node_render(c)).join('')}</ul>
                    </li>`;
        }
        return `<li class="${n.type}${gatherClass}" data-path="${n.path}">${n.name} <span class="dim" style="float:right">${n.size}</span></li>`;
    }

    // ─── Private: Event Handlers ────────────────────────────

    /**
     * Attaches click handlers to the tree via event delegation.
     * In selectable mode, also attaches long-press listeners.
     */
    private handlers_attach(): void {
        if (this.selectable) {
            this.selectableHandlers_attach();
        } else {
            this.standardHandlers_attach();
        }
    }

    /**
     * Standard (non-selectable) handlers: click to toggle folders / preview files.
     */
    private standardHandlers_attach(): void {
        this.treeEl.addEventListener('click', (e: Event): void => {
            const target: HTMLElement = (e.target as HTMLElement).closest('li') as HTMLElement;
            if (!target) return;

            if (target.classList.contains('folder')) {
                target.classList.toggle('open');
                e.stopPropagation();
                return;
            }

            if (target.classList.contains('file')) {
                e.stopPropagation();
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
     * Selectable mode handlers: short click = preview, long press = toggle selection.
     */
    private selectableHandlers_attach(): void {
        this.treeEl.addEventListener('mousedown', (e: Event): void => {
            const me: MouseEvent = e as MouseEvent;
            const target: HTMLElement | null = (me.target as HTMLElement).closest('li');
            if (!target) return;

            this.longPressFired = false;
            this.longPressTimer = setTimeout((): void => {
                this.longPressFired = true;
                this.selectionToggle_handle(target);
            }, LONG_PRESS_MS);
        });

        this.treeEl.addEventListener('mouseup', (e: Event): void => {
            this.longPress_cancel();
            if (this.longPressFired) {
                // Long press already handled — suppress the click
                e.stopPropagation();
                return;
            }

            // Short click — standard behavior
            const target: HTMLElement | null = (e.target as HTMLElement).closest('li');
            if (!target) return;

            if (target.classList.contains('folder')) {
                target.classList.toggle('open');
                e.stopPropagation();
                return;
            }

            if (target.classList.contains('file')) {
                e.stopPropagation();
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

        this.treeEl.addEventListener('mouseleave', (): void => {
            this.longPress_cancel();
        });
    }

    /**
     * Handles selection toggle for a long-pressed tree item.
     * Files: toggle individual path. Folders: toggle all descendant files.
     */
    private selectionToggle_handle(target: HTMLElement): void {
        const nodePath: string | undefined = target.dataset.path;
        if (!nodePath) return;

        if (target.classList.contains('folder')) {
            // Collect all descendant file paths under this folder
            const descendants: string[] = this.descendantPaths_collect(target);
            // If all are already selected, deselect all; otherwise select all
            const allSelected: boolean = descendants.length > 0 && descendants.every(
                (p: string): boolean => this.selectedPaths.has(p)
            );
            for (const p of descendants) {
                if (allSelected) {
                    this.selectedPaths.delete(p);
                } else {
                    this.selectedPaths.add(p);
                }
            }
            // Also toggle the folder itself for visual feedback
            if (allSelected) {
                this.selectedPaths.delete(nodePath);
            } else {
                this.selectedPaths.add(nodePath);
            }
            // Update visual state for all descendants
            this.selectionVisuals_sync(target);
        } else if (target.classList.contains('file')) {
            if (this.selectedPaths.has(nodePath)) {
                this.selectedPaths.delete(nodePath);
                target.classList.remove('selected-for-gather');
            } else {
                this.selectedPaths.add(nodePath);
                target.classList.add('selected-for-gather');
            }
        }

        this.selectionChange_notify();
    }

    /**
     * Collects all descendant file paths from a folder `<li>` element.
     */
    private descendantPaths_collect(folderLi: HTMLElement): string[] {
        const paths: string[] = [];
        folderLi.querySelectorAll<HTMLElement>('li.file').forEach((li: HTMLElement): void => {
            if (li.dataset.path) paths.push(li.dataset.path);
        });
        return paths;
    }

    /**
     * Syncs the `.selected-for-gather` class on all `<li>` elements
     * under a given root element based on the current `selectedPaths` set.
     */
    private selectionVisuals_sync(rootEl: HTMLElement): void {
        rootEl.querySelectorAll<HTMLElement>('li[data-path]').forEach((li: HTMLElement): void => {
            li.classList.toggle(
                'selected-for-gather',
                this.selectedPaths.has(li.dataset.path || '')
            );
        });
        // Also sync the root itself
        rootEl.classList.toggle(
            'selected-for-gather',
            this.selectedPaths.has(rootEl.dataset.path || '')
        );
    }

    /**
     * Cancels the long-press timer if active.
     */
    private longPress_cancel(): void {
        if (this.longPressTimer !== null) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
    }

    /**
     * Notifies the selection change callback with current paths.
     */
    private selectionChange_notify(): void {
        if (this.onSelectionChange) {
            // Only report file paths, not folder paths
            const filePaths: string[] = Array.from(this.selectedPaths).filter(
                (p: string): boolean => {
                    const li: HTMLElement | null = this.treeEl.querySelector(`li[data-path="${p}"]`);
                    return li !== null && li.classList.contains('file');
                }
            );
            this.onSelectionChange(filePaths);
        }
    }

    // ─── Private: Subtree Extraction ────────────────────────

    /**
     * Recursively prunes a tree, keeping only selected files and
     * the directory skeleton needed to reach them.
     */
    private subtree_prune(node: VcsFileNode): VcsFileNode | null {
        if (!node.children) {
            // Leaf file — keep only if selected
            return this.selectedPaths.has(node.path) ? { ...node } : null;
        }

        // Directory — recurse into children
        const keptChildren: VcsFileNode[] = [];
        for (const child of node.children) {
            const kept: VcsFileNode | null = this.subtree_prune(child);
            if (kept) keptChildren.push(kept);
        }

        if (keptChildren.length === 0) return null;

        return {
            ...node,
            children: keptChildren
        };
    }

    // ─── Private: Path + Image Resolution ───────────────────

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
