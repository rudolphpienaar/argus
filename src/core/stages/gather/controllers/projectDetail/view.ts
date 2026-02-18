/**
 * @file Project Detail View Helpers
 *
 * Rendering and view-state helpers for Gather-stage project detail overlay.
 *
 * Responsibilities:
 * - Render project detail header fields.
 * - Build FileBrowser tree projections from VFS.
 * - Render sidebar tabs and content slot browser host.
 *
 * @module core/stages/gather/controllers/projectDetail/view
 */

import { store } from '../../../../state/store.js';
import type { Project } from '../../../../models/types.js';
import type { FileNode as VcsFileNode } from '../../../../../vfs/types.js';
import { FileBrowser } from '../../../../../ui/components/FileBrowser.js';
import { gatherStage_state } from '../../runtime/state.js';
import { vfsTree_build } from '../../utils/tree.js';
import { projectDetailContentHtml_render } from '../../ui/view.js';
import type { ProjectDetailTab } from './types.js';

/**
 * Project context paths used for tree projection.
 */
export interface ProjectDetailPaths {
    root: string;
    src: string;
    input: string;
    output: string;
}

/**
 * Render project header values and LCARS hue.
 */
export function projectDetailHeader_render(project: Project, lcarsFrame: HTMLElement): void {
    lcarsFrame.style.setProperty('--lcars-hue', '30');

    const nameEl: HTMLElement | null = document.getElementById('detail-name');
    const typeBadge: HTMLElement | null = document.getElementById('detail-type-badge');
    const versionEl: HTMLElement | null = document.getElementById('detail-version');
    const starsEl: HTMLElement | null = document.getElementById('detail-stars');
    const authorEl: HTMLElement | null = document.getElementById('detail-author');

    if (nameEl) {
        nameEl.textContent = project.name.toUpperCase();
    }
    if (typeBadge) {
        typeBadge.textContent = 'PROJECT';
    }
    if (versionEl) {
        versionEl.textContent = `v${project.id.split('-').pop()}`;
    }
    if (starsEl) {
        starsEl.textContent = `${project.datasets.length} DATASETS`;
    }
    if (authorEl) {
        authorEl.textContent = `UPDATED: ${project.lastModified.toLocaleDateString()}`;
    }
}

/**
 * Build projected VFS trees used by project-detail FileBrowser.
 */
export function projectDetailTrees_build(paths: ProjectDetailPaths): Record<string, VcsFileNode> {
    const trees: Record<string, VcsFileNode> = {};

    const rootNode: VcsFileNode | null = vfsTree_build(paths.root);
    if (rootNode) {
        trees.root = rootNode;
    }

    const sourceNode: VcsFileNode | null = vfsTree_build(paths.src);
    if (sourceNode) {
        trees.source = sourceNode;
    }

    const inputPath: string = projectDetailInputPath_resolve(paths.input, paths.root);
    const inputNode: VcsFileNode | null = vfsTree_build(inputPath);
    if (inputNode) {
        trees.input = inputNode;
    }

    const outputNode: VcsFileNode | null = vfsTree_build(paths.output);
    if (outputNode) {
        trees.output = outputNode;
    }

    return trees;
}

/**
 * Build sidebar tab model from available trees.
 */
export function projectDetailTabs_build(trees: Record<string, VcsFileNode>): ProjectDetailTab[] {
    const tabs: ProjectDetailTab[] = [];

    if (trees.root) {
        tabs.push({ id: 'root', label: 'ROOT', shade: 1 });
    }
    if (trees.source) {
        tabs.push({ id: 'source', label: 'SOURCE', shade: 2 });
    }
    if (trees.input) {
        tabs.push({ id: 'input', label: 'INPUT', shade: 3 });
    }
    if (trees.output) {
        tabs.push({ id: 'output', label: 'OUTPUT', shade: 1 });
    }

    return tabs;
}

/**
 * Render sidebar slot and bind tab change callback.
 */
export function projectDetailSidebar_render(
    tabs: ReadonlyArray<ProjectDetailTab>,
    activeTab: string,
    onTabChange: (tabId: string, sidebarSlot: HTMLElement) => void,
): void {
    const sidebarSlot: HTMLElement | null = document.getElementById('overlay-sidebar-slot');
    if (!sidebarSlot) {
        return;
    }

    sidebarSlot.innerHTML = '';

    tabs.forEach((tab: ProjectDetailTab): void => {
        const panel: HTMLAnchorElement = document.createElement('a');
        panel.className = 'lcars-panel';
        panel.href = `#${tab.id}`;
        panel.textContent = tab.label;
        panel.dataset.panelId = tab.id;
        panel.dataset.shade = String(tab.shade);
        if (tab.id === activeTab) {
            panel.classList.add('active');
        }

        panel.addEventListener('click', (event: Event): void => {
            event.preventDefault();
            onTabChange(tab.id, sidebarSlot);
        });

        sidebarSlot.appendChild(panel);
    });

    const spacer: HTMLDivElement = document.createElement('div');
    spacer.className = 'lcars-sidebar-spacer';
    spacer.dataset.shade = '4';
    sidebarSlot.appendChild(spacer);

    const bottomPanel: HTMLAnchorElement = document.createElement('a');
    bottomPanel.className = 'lcars-panel lcars-corner-bl';
    bottomPanel.dataset.shade = '3';
    bottomPanel.textContent = 'FILES';
    sidebarSlot.appendChild(bottomPanel);
}

/**
 * Render content slot and mount FileBrowser instance.
 */
export function projectDetailContent_render(
    project: Project,
    projectBase: string,
    trees: Record<string, VcsFileNode>,
): void {
    const contentSlot: HTMLElement | null = document.getElementById('overlay-content-slot');
    if (!contentSlot) {
        return;
    }

    contentSlot.innerHTML = projectDetailContentHtml_render(project);

    const treeEl: HTMLElement | null = document.getElementById('project-file-tree');
    const previewEl: HTMLElement | null = document.getElementById('project-file-preview');
    if (!treeEl || !previewEl) {
        return;
    }

    const detailBrowser: FileBrowser = new FileBrowser({
        treeContainer: treeEl,
        previewContainer: previewEl,
        vfs: store.globals.vcs,
        projectBase,
    });
    detailBrowser.trees_set(trees);
    detailBrowser.tree_render();
    gatherStage_state.detailBrowser = detailBrowser;
}

/**
 * Resolve filesystem path that corresponds to a project-detail tab.
 */
export function projectDetailTabPath_resolve(tabId: string, workspaceProjectBase: string): string {
    if (tabId === 'source') {
        return `${workspaceProjectBase}/src`;
    }
    if (tabId === 'input') {
        return `${workspaceProjectBase}/input`;
    }
    if (tabId === 'output') {
        return `${workspaceProjectBase}/output`;
    }
    return workspaceProjectBase;
}

/**
 * Resolve input tree path, preserving `data/` fallback for legacy projects.
 */
function projectDetailInputPath_resolve(inputPath: string, projectPath: string): string {
    const legacyDataPath: string = `${projectPath}/data`;
    if (!store.globals.vcs.node_stat(inputPath) && store.globals.vcs.node_stat(legacyDataPath)) {
        return legacyDataPath;
    }
    return inputPath;
}
