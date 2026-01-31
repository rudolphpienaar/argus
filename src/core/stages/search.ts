/**
 * @file Search Stage Logic
 *
 * Handles the dataset catalog, project workspace view, and AI integration.
 *
 * @module
 */

import { state, globals, store } from '../state/store.js';
import { DATASETS } from '../data/datasets.js';
import { MOCK_PROJECTS } from '../data/projects.js';
import { stage_advanceTo } from '../logic/navigation.js';
import { cohortTree_build } from '../../vfs/providers/DatasetProvider.js';
import { projectDir_populate } from '../../vfs/providers/ProjectProvider.js';
import { populate_ide, training_launch } from './process.js';
import type { Dataset, Project } from '../models/types.js';
import type { FileNode as VcsFileNode } from '../../vfs/types.js';
import { LCARSEngine } from '../../lcarslm/engine.js';
import { render_assetCard, type AssetCardOptions } from '../../ui/components/AssetCard.js';
import { FileBrowser } from '../../ui/components/FileBrowser.js';

// ============================================================================
// AI / Auth Logic
// ============================================================================

/**
 * Initializes the LCARS LM engine from persisted credentials.
 * Reads API key, provider, and model from localStorage and creates
 * a new LCARSEngine instance if credentials are present.
 */
export function lcarslm_initialize(): void {
    const apiKey: string | null = localStorage.getItem('ARGUS_API_KEY');
    const provider: string | null = localStorage.getItem('ARGUS_PROVIDER');
    const model: string = localStorage.getItem('ARGUS_MODEL') || 'default';

    if (apiKey && provider) {
        globals.lcarsEngine = new LCARSEngine({
            apiKey,
            model: model,
            provider: provider as 'openai' | 'gemini'
        });
        searchUIState_set('ready');
        if (globals.terminal) {
            globals.terminal.setStatus(`MODE: [${provider.toUpperCase()}] // MODEL: [${model.toUpperCase()}]`);
            globals.terminal.println(`>> AI CORE LINK ESTABLISHED: PROVIDER [${provider.toUpperCase()}]`);
        }
    } else {
        searchUIState_set('auth-required');
    }
}

/**
 * Authenticates the user with their API key and provider selection.
 * Persists credentials to localStorage and initializes the engine.
 */
export function lcarslm_auth(): void {
    const input: HTMLInputElement = document.getElementById('api-key-input') as HTMLInputElement;
    const modelInput: HTMLInputElement = document.getElementById('api-model-input') as HTMLInputElement;
    const providerSelect: HTMLSelectElement = document.getElementById('api-provider-select') as HTMLSelectElement;

    const key: string = input.value.trim();
    const provider: string = providerSelect.value;
    const model: string = modelInput.value.trim() || 'default';

    if (key.length > 5) {
        localStorage.setItem('ARGUS_API_KEY', key);
        localStorage.setItem('ARGUS_PROVIDER', provider);
        localStorage.setItem('ARGUS_MODEL', model);
        lcarslm_initialize();
    } else {
        alert('Invalid Key Format.');
    }
}

/**
 * Resets AI credentials by clearing localStorage and nullifying the engine.
 */
export function lcarslm_reset(): void {
    localStorage.removeItem('ARGUS_API_KEY');
    localStorage.removeItem('ARGUS_PROVIDER');
    localStorage.removeItem('ARGUS_OPENAI_KEY');
    globals.lcarsEngine = null;
    searchUIState_set('auth-required');
}

/**
 * Activates simulation mode by creating an engine with null config.
 */
export function lcarslm_simulate(): void {
    globals.lcarsEngine = new LCARSEngine(null);
    searchUIState_set('ready');
    if (globals.terminal) {
        globals.terminal.setStatus('MODE: [SIMULATION] // EMULATION ACTIVE');
        globals.terminal.println('>> AI CORE: SIMULATION MODE ACTIVE. EMULATING NEURAL RESPONSES.');
    }
}

/**
 * Toggles visibility of the auth and query panels based on AI readiness.
 *
 * @param status - The current auth/readiness state.
 */
function searchUIState_set(status: 'auth-required' | 'ready'): void {
    const authPanel: HTMLElement | null = document.getElementById('search-auth-panel');
    const queryPanel: HTMLElement | null = document.getElementById('search-query-panel');
    const statusPanel: HTMLElement | null = document.getElementById('search-status-panel');

    if (authPanel && queryPanel) {
        if (status === 'ready') {
            authPanel.style.display = 'none';
            queryPanel.style.display = 'block';
            if (statusPanel) statusPanel.style.display = 'block';
        } else {
            authPanel.style.display = 'block';
            queryPanel.style.display = 'none';
            if (statusPanel) statusPanel.style.display = 'none';
        }
    }
}

// ============================================================================
// Workspace / Search Logic
// ============================================================================

/**
 * Searches the dataset catalog by query, modality, and annotation filters.
 * If an AI engine is active and a natural-language query is present,
 * delegates to the AI path. Otherwise uses legacy field-based filtering.
 *
 * @param overrideQuery - Optional query string that bypasses UI inputs.
 * @returns The filtered list of matching datasets.
 */
export async function catalog_search(overrideQuery?: string): Promise<Dataset[]> {
    const nlQuery: string = (document.getElementById('search-nl-input') as HTMLInputElement)?.value || '';

    // AI Path
    if (globals.lcarsEngine && nlQuery.trim().length > 0 && !overrideQuery) {
        // ... (AI logic)
    }

    // Legacy Path
    const query: string = overrideQuery || (document.getElementById('search-query') as HTMLInputElement)?.value.toLowerCase() || '';
    const modality: string = (document.getElementById('search-modality') as HTMLSelectElement)?.value || '';
    const annotation: string = (document.getElementById('search-annotation') as HTMLSelectElement)?.value || '';

    const filtered: Dataset[] = DATASETS.filter((ds: Dataset): boolean => {
        const matchesQuery: boolean = !query || ds.name.toLowerCase().includes(query.toLowerCase()) || ds.description.toLowerCase().includes(query.toLowerCase());
        const matchesModality: boolean = !modality || ds.modality === modality;
        const matchesAnnotation: boolean = !annotation || ds.annotationType === annotation;
        return matchesQuery && matchesModality && matchesAnnotation;
    });

    const isSearchActive: boolean = (query.trim() !== '') || (modality !== '') || (annotation !== '');
    workspace_render(filtered, isSearchActive);

    return filtered;
}

/**
 * Renders the workspace view — persistent project strip at top,
 * dataset tiles below.
 *
 * @param datasets - The datasets to display.
 * @param isSearchActive - Whether any search filter is currently active.
 */
export function workspace_render(datasets: Dataset[], isSearchActive: boolean): void {
    // Always render the persistent project strip
    projectStrip_render();

    const container: HTMLElement | null = document.getElementById('dataset-results');
    if (!container) return;

    // If no search is active and no datasets provided, show a prompt
    if (!isSearchActive && datasets.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem 1rem; color: var(--font-color); opacity: 0.6;">
                <p style="font-size: 1.1rem;">USE THE AI CORE TO SEARCH FOR DATASETS</p>
                <p style="font-size: 0.85rem; color: var(--harvestgold);">OR SELECT A PROJECT ABOVE TO OPEN AN EXISTING WORKSPACE</p>
            </div>
        `;
        return;
    }

    // Render dataset tiles using AssetCard for visual convergence
    container.innerHTML = datasets.map((ds: Dataset): string => {
        const isGathered: boolean = gatheredDatasets.has(ds.id);
        const opts: AssetCardOptions = {
            id: ds.id,
            type: 'dataset',
            title: ds.name.toUpperCase(),
            description: ds.description,
            metaLeft: `${ds.provider}`,
            metaRight: `${ds.imageCount.toLocaleString()} IMAGES · ${ds.size}`,
            badgeText: `${ds.modality.toUpperCase()} · ${ds.annotationType.toUpperCase()}`,
            badgeRightText: `$${ds.cost.toFixed(2)}`,
            isInstalled: isGathered,
            onClick: `datasetDetail_open('${ds.id}')`,
            actionButton: {
                label: isGathered ? 'GATHERED' : 'BROWSE',
                activeLabel: 'GATHERED',
                onClick: `datasetDetail_open('${ds.id}')`,
                isActive: isGathered
            }
        };
        return render_assetCard(opts);
    }).join('');

    // Apply gathered class to cards
    gatheredDatasets.forEach((_entry: GatheredEntry, dsId: string): void => {
        const card: HTMLElement | null = container.querySelector(`[data-id="${dsId}"]`);
        if (card) card.classList.add('gathered');
    });
}

/**
 * Renders the persistent project strip at the top of the Search stage.
 * Shows compact project chips and a "+ NEW" chip.
 */
function projectStrip_render(): void {
    const strip: HTMLElement | null = document.getElementById('project-strip');
    if (!strip) return;

    let html: string = '<span class="project-strip-header">PROJECTS</span>';

    html += MOCK_PROJECTS.map((p: Project): string => {
        const isActive: boolean = gatherTargetProject !== null && gatherTargetProject.id === p.id;
        const dsCount: number = p.datasets.length;
        return `<div class="project-chip${isActive ? ' active' : ''}" data-id="${p.id}">
                    ${p.name.toUpperCase()}
                    <span class="chip-badge">${dsCount}DS</span>
                </div>`;
    }).join('');

    html += '<div class="project-chip new-project">+ NEW</div>';
    strip.innerHTML = html;

    // Attach click handlers
    strip.querySelectorAll<HTMLElement>('.project-chip[data-id]').forEach((chip: HTMLElement): void => {
        chip.addEventListener('click', (): void => {
            const id: string = chip.dataset.id || '';
            projectChip_toggle(id);
        });
    });

    strip.querySelector('.project-chip.new-project')?.addEventListener('click', (): void => {
        // Deselect any active project — new project mode
        gatherTargetProject = null;
        projectStrip_render();
        if (globals.terminal) {
            globals.terminal.println('○ NEW PROJECT MODE: GATHER DATA TO CREATE A NEW PROJECT.');
        }
    });
}

/**
 * Toggles a project chip between active (gather target) and inactive.
 * Single-click toggles gather target. Double-click opens project detail.
 */
function projectChip_toggle(projectId: string): void {
    const project: Project | undefined = MOCK_PROJECTS.find((p: Project): boolean => p.id === projectId);
    if (!project) return;

    if (gatherTargetProject && gatherTargetProject.id === projectId) {
        // Already active — open the project detail
        projectDetail_open(projectId);
    } else {
        // Set as gather target
        gatherTargetProject = project;
        projectStrip_render();
        if (globals.terminal) {
            globals.terminal.println(`● GATHER TARGET: [${project.name.toUpperCase()}]`);
            globals.terminal.println('○ BROWSE DATASETS AND GATHER DATA FOR THIS PROJECT.');
        }
    }
}

/**
 * Selects a dataset by ID and adds it to the cohort buffer.
 *
 * @param datasetId - The dataset identifier.
 * @param quiet - If true, suppresses terminal output.
 */
export function dataset_select(datasetId: string, quiet: boolean = false): void {
    const dataset: Dataset | undefined = DATASETS.find((ds: Dataset): boolean => ds.id === datasetId);
    if (!dataset) return;

    const exists: boolean = state.selectedDatasets.some((ds: Dataset): boolean => ds.id === datasetId);
    if (!exists) {
        state.selectedDatasets.push(dataset);

        // Update UI
        const card: Element | null = document.querySelector(`.dataset-card[data-id="${datasetId}"]`);
        if (card) card.classList.add('selected');

        if (!quiet && globals.terminal) {
            globals.terminal.println(`● SELECTED DATASET: [${dataset.id}] ${dataset.name}`);
            globals.terminal.println(`○ ADDED TO COHORT BUFFER. SELECT MORE OR PROCEED TO GATHER.`);
        }

        // Update cascading stats
        import('./gather.js').then((m: { selectionCount_update: () => void }): void => m.selectionCount_update());
        import('../logic/telemetry.js').then((m: { cascade_update: () => void }): void => m.cascade_update());
    }
}

/**
 * Deselects a dataset by ID and removes it from the cohort buffer.
 *
 * @param datasetId - The dataset identifier.
 * @param quiet - If true, suppresses terminal output.
 */
export function dataset_deselect(datasetId: string, quiet: boolean = false): void {
    const index: number = state.selectedDatasets.findIndex((ds: Dataset): boolean => ds.id === datasetId);
    if (index >= 0) {
        const dataset: Dataset = state.selectedDatasets[index];
        state.selectedDatasets.splice(index, 1);

        // Update UI
        const card: Element | null = document.querySelector(`.dataset-card[data-id="${datasetId}"]`);
        if (card) card.classList.remove('selected');

        if (!quiet && globals.terminal) {
            globals.terminal.println(`○ DESELECTED DATASET: [${datasetId}] ${dataset.name}`);
        }

        // Update cascading stats
        import('./gather.js').then((m: { selectionCount_update: () => void }): void => m.selectionCount_update());
        import('../logic/telemetry.js').then((m: { cascade_update: () => void }): void => m.cascade_update());
    }
}

/**
 * Toggles a dataset's selection state by ID.
 *
 * @param datasetId - The dataset identifier.
 */
export function dataset_toggle(datasetId: string): void {
    const exists: boolean = state.selectedDatasets.some((ds: Dataset): boolean => ds.id === datasetId);
    if (exists) {
        dataset_deselect(datasetId);
    } else {
        dataset_select(datasetId);
    }
}

/**
 * Activates a project by loading it into the store, mounting its
 * cohort tree into the VCS, and transitioning to the Process stage.
 *
 * @param projectId - The project identifier.
 */
export function project_activate(projectId: string): void {
    const project: Project | undefined = MOCK_PROJECTS.find((p: Project): boolean => p.id === projectId);
    if (!project) return;

    // Use Store Action
    store.project_load(project);

    // Build cohort tree and mount to VCS under ~/projects/{name}/data
    const projectBase: string = `/home/user/projects/${project.name}`;
    const cohortRoot: VcsFileNode = cohortTree_build(project.datasets);
    globals.vcs.tree_unmount(`${projectBase}/data`);
    globals.vcs.dir_create(`${projectBase}/src`);
    globals.vcs.tree_mount(`${projectBase}/data`, cohortRoot);
    globals.vcs.cwd_set(projectBase);

    // Set $PROJECT so Shell landing dirs resolve to project-scoped paths
    if (globals.shell) {
        globals.shell.env_set('PROJECT', project.name);
    }

    if (globals.terminal) {
        globals.terminal.prompt_sync();
        globals.terminal.println(`● MOUNTING PROJECT: [${project.name.toUpperCase()}]`);
        globals.terminal.println(`○ LOADED ${project.datasets.length} DATASETS.`);
    }

    // View Transitions
    stage_advanceTo('process');
    populate_ide();
}

// ============================================================================
// Project Detail View
// ============================================================================

/**
 * Closes the project detail overlay with a slide-out animation
 * matching the visual language spec.
 */
function projectDetail_close(): void {
    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;

    // Collapse workspace if expanded
    if (isWorkspaceExpanded) {
        workspace_collapse();
        // Close terminal if open
        if (globals.frameSlot && globals.frameSlot.state_isOpen()) {
            globals.frameSlot.frame_close();
        }
    }

    // Clean up FileBrowser instance
    if (detailBrowser) {
        detailBrowser.destroy();
        detailBrowser = null;
    }

    // Clear slot contents and reset mode
    overlaySlots_clear();
    overlay.dataset.mode = 'marketplace';

    overlay.classList.add('closing');
    overlay.addEventListener('animationend', (): void => {
        overlay.classList.add('hidden');
        overlay.classList.remove('closing');
    }, { once: true });
}

// ─── Module State ───────────────────────────────────────────

/** Active FileBrowser instance for the project detail overlay. */
let detailBrowser: FileBrowser | null = null;

/** Whether the detail overlay is in expanded workspace mode. */
let isWorkspaceExpanded: boolean = false;

/** Project base path while workspace is expanded (for pwd↔tab sync). */
let workspaceProjectBase: string = '';

/** Drag listener cleanup for the terminal resize handle. */
let workspaceDragCleanup: (() => void) | null = null;

/** Drag listener cleanup for the browser resize handle. */
let browserDragCleanup: (() => void) | null = null;

/** The project currently targeted for data gathering (highlighted in the strip). */
let gatherTargetProject: Project | null = null;

/** Accumulated gathered datasets: datasetId → { dataset, selectedPaths, subtree }. */
interface GatheredEntry {
    dataset: Dataset;
    selectedPaths: string[];
    subtree: VcsFileNode;
}
const gatheredDatasets: Map<string, GatheredEntry> = new Map();

/** Active FileBrowser for dataset detail (separate from project detail browser). */
let datasetBrowser: FileBrowser | null = null;

/** The dataset currently being viewed in the detail overlay. */
let activeDetailDataset: Dataset | null = null;

// ─── Project Detail Populate ────────────────────────────────

function projectDetail_populate(
    project: Project,
    projectId: string,
    overlay: HTMLElement,
    lcarsFrame: HTMLElement
): void {
    const projectBase: string = `/home/user/projects/${project.name}`;

    // Set overlay mode — CSS hides marketplace originals, shows slots
    overlay.dataset.mode = 'project';

    // 1. Style & Header
    lcarsFrame.style.setProperty('--lcars-hue', '30');

    const nameEl: HTMLElement | null = document.getElementById('detail-name');
    const typeBadge: HTMLElement | null = document.getElementById('detail-type-badge');
    const versionEl: HTMLElement | null = document.getElementById('detail-version');
    const starsEl: HTMLElement | null = document.getElementById('detail-stars');
    const authorEl: HTMLElement | null = document.getElementById('detail-author');

    if (nameEl) nameEl.textContent = project.name.toUpperCase();
    if (typeBadge) typeBadge.textContent = 'PROJECT';
    if (versionEl) versionEl.textContent = `v${project.id.split('-').pop()}`;
    if (starsEl) starsEl.textContent = `${project.datasets.length} DATASETS`;
    if (authorEl) authorEl.textContent = `UPDATED: ${project.lastModified.toLocaleDateString()}`;

    // 2. Build both file trees upfront
    const cohortRoot: VcsFileNode = cohortTree_build(project.datasets);
    const srcRoot: VcsFileNode = {
        name: 'src', type: 'folder', path: '/src', size: '-', modified: new Date(),
        content: null, contentGenerator: null, permissions: 'rw', metadata: {},
        children: [
            { name: 'train.py', type: 'file', path: '/src/train.py', size: '2KB', modified: new Date(), content: null, contentGenerator: 'train', permissions: 'rw', metadata: {}, children: null },
            { name: 'config.yaml', type: 'file', path: '/src/config.yaml', size: '500B', modified: new Date(), content: null, contentGenerator: 'config', permissions: 'rw', metadata: {}, children: null },
            { name: 'requirements.txt', type: 'file', path: '/src/requirements.txt', size: '200B', modified: new Date(), content: null, contentGenerator: 'requirements', permissions: 'rw', metadata: {}, children: null },
            { name: 'README.md', type: 'file', path: '/src/README.md', size: '1KB', modified: new Date(), content: null, contentGenerator: 'readme', permissions: 'rw', metadata: {}, children: null },
            {
                name: '.meridian', type: 'folder', path: '/src/.meridian', size: '-', modified: new Date(),
                content: null, contentGenerator: null, permissions: 'rw', metadata: {},
                children: [
                    { name: 'manifest.json', type: 'file', path: '/src/.meridian/manifest.json', size: '300B', modified: new Date(), content: null, contentGenerator: 'manifest', permissions: 'rw', metadata: {}, children: null }
                ]
            }
        ]
    };

    const trees: Record<string, VcsFileNode> = { source: srcRoot, data: cohortRoot };
    let activeTab: string = 'source';

    // 3. Ensure project files exist in VFS for preview
    projectDir_populate(globals.vcs, 'user', project.name);
    globals.vcs.tree_unmount(`${projectBase}/data`);
    globals.vcs.tree_mount(`${projectBase}/data`, cohortRoot);

    // 4. Sidebar → write into #overlay-sidebar-slot (never touch marketplace original)
    const sidebarSlot: HTMLElement | null = document.getElementById('overlay-sidebar-slot');
    if (sidebarSlot) {
        sidebarSlot.innerHTML = '';

        const tabs: Array<{ id: string; label: string; shade: number }> = [
            { id: 'source', label: 'SOURCE', shade: 1 },
            { id: 'data', label: 'DATA', shade: 2 }
        ];

        tabs.forEach((tab): void => {
            const panel: HTMLAnchorElement = document.createElement('a');
            panel.className = 'lcars-panel';
            panel.href = `#${tab.id}`;
            panel.textContent = tab.label;
            panel.dataset.panelId = tab.id;
            panel.dataset.shade = String(tab.shade);
            if (tab.id === 'source') panel.classList.add('active');

            panel.addEventListener('click', (e: Event): void => {
                e.preventDefault();
                activeTab = tab.id;
                sidebarSlot.querySelectorAll<HTMLElement>('.lcars-panel').forEach((p: HTMLElement): void => {
                    p.classList.toggle('active', p.dataset.panelId === tab.id);
                });
                if (detailBrowser) detailBrowser.tab_switch(tab.id);

                // Sync terminal pwd when workspace is active
                if (isWorkspaceExpanded && workspaceProjectBase) {
                    const subdir: string = tab.id === 'source' ? 'src' : 'data';
                    const targetPath: string = `${workspaceProjectBase}/${subdir}`;
                    globals.vcs.cwd_set(targetPath);
                    if (globals.terminal) globals.terminal.prompt_sync();
                }
            });

            sidebarSlot.appendChild(panel);
        });

        // Spacer fills remaining sidebar height
        const spacer: HTMLDivElement = document.createElement('div');
        spacer.className = 'lcars-sidebar-spacer';
        spacer.dataset.shade = '4';
        sidebarSlot.appendChild(spacer);

        // Bottom corner panel to close the frame cleanly
        const bottomPanel: HTMLAnchorElement = document.createElement('a');
        bottomPanel.className = 'lcars-panel lcars-corner-bl';
        bottomPanel.dataset.shade = '3';
        bottomPanel.textContent = 'FILES';
        sidebarSlot.appendChild(bottomPanel);
    }

    // 5. Content → write into #overlay-content-slot
    const contentSlot: HTMLElement | null = document.getElementById('overlay-content-slot');
    if (contentSlot) {
        contentSlot.innerHTML = `
            <section class="detail-section project-browser">
                <div class="project-browser-layout">
                    <div class="file-tree" id="project-file-tree" style="border-color: var(--honey);">
                        <ul class="interactive-tree"></ul>
                    </div>
                    <div class="file-preview" id="project-file-preview">
                        <p class="dim">Select a file to preview</p>
                    </div>
                </div>
                <div class="project-meta" style="margin-top: 1rem; color: var(--font-color); font-family: monospace;">
                    <p>Total Cohort Size: <strong>${(project.datasets.length * 150).toFixed(0)} MB</strong> (Estimated)</p>
                    <p>Privacy Budget: <strong>ε=3.0</strong></p>
                </div>
            </section>
        `;

        // Instantiate reusable FileBrowser
        const treeEl: HTMLElement | null = document.getElementById('project-file-tree');
        const previewEl: HTMLElement | null = document.getElementById('project-file-preview');
        if (treeEl && previewEl) {
            detailBrowser = new FileBrowser({
                treeContainer: treeEl,
                previewContainer: previewEl,
                vfs: globals.vcs,
                projectBase: projectBase
            });
            detailBrowser.trees_set(trees);
            detailBrowser.tree_render();
        }
    }

    // 6. Command pills → write CLOSE + OPEN into #overlay-command-slot
    const commandSlot: HTMLElement | null = document.getElementById('overlay-command-slot');
    if (commandSlot) {
        commandSlot.style.setProperty('--module-color', 'var(--honey)');
        commandSlot.innerHTML = `
            <button class="pill-btn close-pill" id="project-close-btn">
                <span class="btn-text">CLOSE</span>
            </button>
            <button class="pill-btn install-pill" id="project-open-btn">
                <span class="btn-text">OPEN</span>
            </button>
        `;

        document.getElementById('project-close-btn')?.addEventListener('click', (): void => {
            projectDetail_close();
        });

        document.getElementById('project-open-btn')?.addEventListener('click', (e: Event): void => {
            e.stopPropagation();
            workspace_expand(projectId, project);
        });
    }
}

// ─── Workspace Expand / Collapse ────────────────────────────

/**
 * Expands the detail overlay into a full-width workspace with
 * a split-pane layout: terminal (top) + divider + file browser (bottom).
 *
 * Phase 1: Widen layout, hide pills, set up split-pane DOM.
 * Phase 2: Activate terminal, mount project in shell.
 * Phase 3: Set default split ratio and show FEDERALIZE button.
 */
function workspace_expand(projectId: string, project: Project): void {
    if (isWorkspaceExpanded) return;
    isWorkspaceExpanded = true;

    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    const layout: HTMLElement | null = overlay?.querySelector('.detail-layout') as HTMLElement;
    const commandSlot: HTMLElement | null = document.getElementById('overlay-command-slot');
    const rightFrame: HTMLElement | null = document.querySelector('.right-frame') as HTMLElement;
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');

    if (!overlay || !layout || !rightFrame || !consoleEl) return;

    const projectBase: string = `/home/user/projects/${project.name}`;
    workspaceProjectBase = projectBase;

    // Phase 1: Expand layout, hide pills, enter split-pane mode
    layout.classList.add('workspace-expanded');
    overlay.dataset.workspace = 'true';
    overlay.classList.add('workspace-expanded');

    // Hide marketplace overlay and stage content
    const marketOverlay: HTMLElement | null = document.getElementById('marketplace-overlay');
    if (marketOverlay) marketOverlay.classList.add('hidden');
    const stageContent: HTMLElement | null = document.querySelector('.stage-content[data-stage="search"]') as HTMLElement;
    if (stageContent) stageContent.style.display = 'none';

    if (commandSlot) {
        commandSlot.classList.add('command-col-hiding');
        commandSlot.addEventListener('transitionend', (): void => {
            commandSlot.style.display = 'none';
        }, { once: true });
    }

    // Activate split-pane: flex column on right-frame
    rightFrame.classList.add('workspace-active');

    // Create terminal resize handle and insert between terminal and overlay
    const termHandle: HTMLDivElement = document.createElement('div');
    termHandle.className = 'workspace-resize-handle';
    termHandle.dataset.target = 'terminal';
    consoleEl.insertAdjacentElement('afterend', termHandle);

    // Move overlay right after the terminal handle so DOM order is:
    // terminal → termHandle → overlay → browserHandle
    termHandle.insertAdjacentElement('afterend', overlay);

    // Create browser resize handle after the overlay
    const browserHandle: HTMLDivElement = document.createElement('div');
    browserHandle.className = 'workspace-resize-handle';
    browserHandle.dataset.target = 'browser';
    overlay.insertAdjacentElement('afterend', browserHandle);

    // Attach drag listeners for both handles
    workspaceDragCleanup = workspaceTerminalResize_attach(termHandle, consoleEl);
    browserDragCleanup = workspaceBrowserResize_attach(browserHandle, overlay);

    // Phase 2: Terminal activation (after layout transition settles)
    setTimeout((): void => {
        // Load project into store + VFS
        store.project_load(project);

        const cohortRoot: VcsFileNode = cohortTree_build(project.datasets);
        globals.vcs.tree_unmount(`${projectBase}/data`);
        globals.vcs.dir_create(`${projectBase}/src`);
        globals.vcs.tree_mount(`${projectBase}/data`, cohortRoot);
        globals.vcs.cwd_set(projectBase);

        if (globals.shell) {
            globals.shell.env_set('PROJECT', project.name);
        }

        // Open terminal
        if (globals.frameSlot && !globals.frameSlot.state_isOpen()) {
            globals.frameSlot.frame_open();
        }

        // Phase 3: Set default split — terminal gets 30% of frame
        setTimeout((): void => {
            const frameH: number = rightFrame.clientHeight;
            const defaultTermH: number = Math.round(frameH * 0.3);
            consoleEl.style.height = `${defaultTermH}px`;
            consoleEl.style.transition = 'none';
            // Restore transition after a tick so future FrameSlot
            // operations (if any) still animate smoothly
            requestAnimationFrame((): void => {
                consoleEl.style.transition = '';
            });
        }, 100);

        if (globals.terminal) {
            globals.terminal.prompt_sync();
            globals.terminal.println(`● MOUNTING PROJECT: [${project.name.toUpperCase()}]`);
            globals.terminal.println(`○ LOADED ${project.datasets.length} DATASETS.`);
            globals.terminal.println('○ WORKSPACE ACTIVE. FILE BROWSER READY.');
        }

        // Register pwd→tab sync
        if (globals.shell) {
            globals.shell.onCwdChange_set((newCwd: string): void => {
                if (!isWorkspaceExpanded || !detailBrowser) return;
                const tabId: string | null = cwdToTab_resolve(newCwd);
                if (tabId && tabId !== detailBrowser.activeTab_get()) {
                    detailBrowser.tab_switch(tabId);
                    const sidebarSlotEl: HTMLElement | null = document.getElementById('overlay-sidebar-slot');
                    if (sidebarSlotEl) {
                        sidebarSlotEl.querySelectorAll<HTMLElement>('.lcars-panel').forEach((p: HTMLElement): void => {
                            p.classList.toggle('active', p.dataset.panelId === tabId);
                        });
                    }
                }
            });
        }

        workspace_federalizeButton_add();
    }, 400);
}

/**
 * Attaches drag-to-resize listeners to the terminal resize handle.
 * Dragging changes the terminal height independently.
 * Returns a cleanup function that removes all listeners.
 */
function workspaceTerminalResize_attach(
    handle: HTMLElement,
    consoleEl: HTMLElement
): () => void {
    let isDragging: boolean = false;
    let startY: number = 0;
    let startTermH: number = 0;

    const onMouseDown = (e: MouseEvent): void => {
        isDragging = true;
        startY = e.clientY;
        startTermH = consoleEl.offsetHeight;
        handle.classList.add('active');
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent): void => {
        if (!isDragging) return;
        const delta: number = e.clientY - startY;
        const newTermH: number = Math.max(80, startTermH + delta);
        consoleEl.style.height = `${newTermH}px`;
        consoleEl.style.transition = 'none';
    };

    const onMouseUp = (): void => {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
        consoleEl.style.transition = '';
    };

    handle.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return (): void => {
        handle.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };
}

/**
 * Attaches drag-to-resize listeners to the browser resize handle.
 * Dragging changes the file browser (overlay) height independently.
 * Returns a cleanup function that removes all listeners.
 */
function workspaceBrowserResize_attach(
    handle: HTMLElement,
    overlay: HTMLElement
): () => void {
    let isDragging: boolean = false;
    let startY: number = 0;
    let startBrowserH: number = 0;

    const onMouseDown = (e: MouseEvent): void => {
        isDragging = true;
        startY = e.clientY;
        startBrowserH = overlay.offsetHeight;
        handle.classList.add('active');
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent): void => {
        if (!isDragging) return;
        const delta: number = e.clientY - startY;
        const newH: number = Math.max(300, startBrowserH + delta);
        overlay.style.height = `${newH}px`;
    };

    const onMouseUp = (): void => {
        if (!isDragging) return;
        isDragging = false;
        handle.classList.remove('active');
        document.body.style.cursor = '';
    };

    handle.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return (): void => {
        handle.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };
}

/**
 * Adds a FEDERALIZE AND LAUNCH button to the workspace content area.
 */
function workspace_federalizeButton_add(): void {
    const metaEl: Element | null = document.querySelector('.project-meta');
    if (!metaEl) return;

    const existing: HTMLElement | null = document.getElementById('workspace-federalize-btn');
    if (existing) existing.remove();

    const btn: HTMLButtonElement = document.createElement('button');
    btn.id = 'workspace-federalize-btn';
    btn.className = 'pill-btn install-pill';
    btn.style.cssText = 'margin-top: 1.5rem; width: 100%; max-width: 400px; height: 50px; font-size: 1rem;';
    btn.innerHTML = '<span class="btn-text">FEDERALIZE AND LAUNCH</span>';
    btn.onclick = (): void => {
        training_launch();
    };

    metaEl.appendChild(btn);
}

/**
 * Maps a cwd path to the corresponding sidebar tab ID.
 * Returns 'source' if cwd is under .../src, 'data' if under .../data,
 * or null if it doesn't map to either.
 */
function cwdToTab_resolve(cwd: string): string | null {
    if (!workspaceProjectBase) return null;
    const relative: string = cwd.startsWith(workspaceProjectBase)
        ? cwd.substring(workspaceProjectBase.length)
        : '';
    if (relative === '/src' || relative.startsWith('/src/')) return 'source';
    if (relative === '/data' || relative.startsWith('/data/')) return 'data';
    return null;
}

/**
 * Reverses the workspace expansion, restoring the detail overlay
 * to its original constrained layout and tearing down the split-pane.
 */
function workspace_collapse(): void {
    if (!isWorkspaceExpanded) return;
    isWorkspaceExpanded = false;
    workspaceProjectBase = '';

    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    const layout: HTMLElement | null = overlay?.querySelector('.detail-layout') as HTMLElement;
    const commandSlot: HTMLElement | null = document.getElementById('overlay-command-slot');
    const rightFrame: HTMLElement | null = document.querySelector('.right-frame') as HTMLElement;
    const consoleEl: HTMLElement | null = document.getElementById('intelligence-console');

    // Tear down resize handles and their drag listeners
    if (workspaceDragCleanup) {
        workspaceDragCleanup();
        workspaceDragCleanup = null;
    }
    if (browserDragCleanup) {
        browserDragCleanup();
        browserDragCleanup = null;
    }
    rightFrame?.querySelectorAll('.workspace-resize-handle').forEach((h: Element): void => h.remove());

    if (rightFrame) rightFrame.classList.remove('workspace-active');

    // Clear inline height set by drag so FrameSlot controls it again
    if (consoleEl) {
        consoleEl.style.height = '';
        consoleEl.style.transition = '';
    }

    if (layout) {
        layout.classList.remove('workspace-expanded');
    }
    if (overlay) {
        overlay.classList.remove('workspace-expanded');
        overlay.style.height = '';
        delete overlay.dataset.workspace;
    }
    if (commandSlot) {
        commandSlot.style.display = '';
        commandSlot.classList.remove('command-col-hiding');
    }

    // Restore marketplace overlay visibility
    const marketOverlay: HTMLElement | null = document.getElementById('marketplace-overlay');
    if (marketOverlay) marketOverlay.classList.remove('hidden');

    // Restore stage content visibility
    const stageContent: HTMLElement | null = document.querySelector('.stage-content[data-stage="search"]') as HTMLElement;
    if (stageContent) stageContent.style.display = '';

    // Unregister pwd→tab sync
    if (globals.shell) {
        globals.shell.onCwdChange_set(null);
    }

    // Clean up FileBrowser instance
    if (detailBrowser) {
        detailBrowser.destroy();
        detailBrowser = null;
    }

    // Remove federalize button
    const fedBtn: HTMLElement | null = document.getElementById('workspace-federalize-btn');
    if (fedBtn) fedBtn.remove();
}

/**
 * Fully tears down the workspace: collapses the split-pane layout,
 * hides the asset-detail overlay, and clears slot contents.
 * Called by the federation handshake before transitioning to Monitor.
 */
export function workspace_teardown(): void {
    if (isWorkspaceExpanded) {
        workspace_collapse();
    }

    // Hide and reset the asset-detail overlay
    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        overlay.classList.remove('closing', 'workspace-expanded');
        overlay.dataset.mode = 'marketplace';
        delete overlay.dataset.workspace;
    }

    // Clean up FileBrowser if still alive
    if (detailBrowser) {
        detailBrowser.destroy();
        detailBrowser = null;
    }

    overlaySlots_clear();

    // Close terminal if open (monitor has its own telemetry)
    if (globals.frameSlot && globals.frameSlot.state_isOpen()) {
        globals.frameSlot.frame_close();
    }
}

// ─── Project Detail Open / Close ────────────────────────────

/**
 * Opens the project detail overlay (reusing asset detail UI).
 * If the Intelligence Console is open, closes it first (600ms frame
 * collapse), then slides in the detail overlay. This ensures the
 * detail appears at the top of the workspace without requiring scroll.
 * The FrameSlot onClose callback handles the bar-10 beckon pulse.
 *
 * @param projectId - The project identifier.
 */
export function projectDetail_open(projectId: string): void {
    const project: Project | undefined = MOCK_PROJECTS.find((p: Project): boolean => p.id === projectId);
    if (!project) return;

    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    const lcarsFrame: HTMLElement | null = document.getElementById('detail-lcars-frame');
    if (!overlay || !lcarsFrame) return;

    // Populate content while overlay is still hidden
    projectDetail_populate(project, projectId, overlay, lcarsFrame);

    // Close terminal first if open, then reveal the detail overlay
    const frameSlot = globals.frameSlot;
    if (frameSlot && frameSlot.state_isOpen()) {
        frameSlot.frame_close().then((): void => {
            overlay.classList.remove('hidden', 'closing');
        });
    } else {
        overlay.classList.remove('hidden', 'closing');
    }
}

// ============================================================================
// Dataset Detail View (Selectable Gather Mode)
// ============================================================================

/**
 * Opens the dataset detail overlay with a selectable FileBrowser
 * showing the dataset's data tree. Used for granular file/dir gathering.
 *
 * @param datasetId - The dataset identifier.
 */
export function datasetDetail_open(datasetId: string): void {
    const dataset: Dataset | undefined = DATASETS.find((ds: Dataset): boolean => ds.id === datasetId);
    if (!dataset) return;

    activeDetailDataset = dataset;

    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    const lcarsFrame: HTMLElement | null = document.getElementById('detail-lcars-frame');
    if (!overlay || !lcarsFrame) return;

    datasetDetail_populate(dataset, overlay, lcarsFrame);

    // Close terminal first if open, then reveal
    const frameSlot = globals.frameSlot;
    if (frameSlot && frameSlot.state_isOpen()) {
        frameSlot.frame_close().then((): void => {
            overlay.classList.remove('hidden', 'closing');
        });
    } else {
        overlay.classList.remove('hidden', 'closing');
    }
}

/**
 * Populates the detail overlay for a dataset in selectable gather mode.
 */
function datasetDetail_populate(
    dataset: Dataset,
    overlay: HTMLElement,
    lcarsFrame: HTMLElement
): void {
    // Set overlay mode — CSS hides marketplace originals, shows slots
    overlay.dataset.mode = 'dataset';

    // 1. Style & Header
    lcarsFrame.style.setProperty('--lcars-hue', '200');

    const nameEl: HTMLElement | null = document.getElementById('detail-name');
    const typeBadge: HTMLElement | null = document.getElementById('detail-type-badge');
    const versionEl: HTMLElement | null = document.getElementById('detail-version');
    const starsEl: HTMLElement | null = document.getElementById('detail-stars');
    const authorEl: HTMLElement | null = document.getElementById('detail-author');

    if (nameEl) nameEl.textContent = dataset.name.toUpperCase();
    if (typeBadge) typeBadge.textContent = 'DATASET';
    if (versionEl) versionEl.textContent = `${dataset.modality.toUpperCase()}`;
    if (starsEl) starsEl.textContent = `${dataset.imageCount.toLocaleString()} IMAGES`;
    if (authorEl) authorEl.textContent = dataset.provider;

    // 2. Build data tree
    const dataRoot: VcsFileNode = cohortTree_build([dataset]);
    const totalFiles: number = fileCount_total(dataRoot);
    const costPerFile: number = totalFiles > 0 ? dataset.cost / totalFiles : 0;

    // 3. Mount to VFS temporarily for preview
    const tempBase: string = `/home/user/datasets/${dataset.id}`;
    try { globals.vcs.dir_create(tempBase); } catch { /* exists */ }
    globals.vcs.tree_unmount(`${tempBase}/data`);
    globals.vcs.tree_mount(`${tempBase}/data`, dataRoot);

    // 4. Sidebar → write into #overlay-sidebar-slot
    const sidebarSlot: HTMLElement | null = document.getElementById('overlay-sidebar-slot');
    if (sidebarSlot) {
        sidebarSlot.innerHTML = '';

        const dataPanel: HTMLAnchorElement = document.createElement('a');
        dataPanel.className = 'lcars-panel active';
        dataPanel.textContent = 'DATA';
        dataPanel.dataset.shade = '1';
        sidebarSlot.appendChild(dataPanel);

        const spacer: HTMLDivElement = document.createElement('div');
        spacer.className = 'lcars-sidebar-spacer';
        spacer.dataset.shade = '4';
        sidebarSlot.appendChild(spacer);

        const bottomPanel: HTMLAnchorElement = document.createElement('a');
        bottomPanel.className = 'lcars-panel lcars-corner-bl';
        bottomPanel.dataset.shade = '2';
        bottomPanel.textContent = 'GATHER';
        sidebarSlot.appendChild(bottomPanel);
    }

    // 5. Content → write into #overlay-content-slot
    const contentSlot: HTMLElement | null = document.getElementById('overlay-content-slot');
    if (contentSlot) {
        contentSlot.innerHTML = `
            <section class="detail-section project-browser">
                <div class="project-browser-layout">
                    <div class="file-tree" id="dataset-file-tree" style="border-color: var(--sky);">
                        <ul class="interactive-tree"></ul>
                    </div>
                    <div class="file-preview" id="dataset-file-preview">
                        <p class="dim">Select a file to preview · Long-press to select for gathering</p>
                    </div>
                </div>
                <div class="gather-cost-strip" id="gather-cost-strip">
                    <span>SELECTED: <strong id="gather-selected-count">0</strong> / ${totalFiles} FILES</span>
                    <span>ESTIMATED COST: <span class="cost-value" id="gather-cost-value">$0.00</span></span>
                </div>
            </section>
        `;

        // Instantiate selectable FileBrowser
        const treeEl: HTMLElement | null = document.getElementById('dataset-file-tree');
        const previewEl: HTMLElement | null = document.getElementById('dataset-file-preview');
        if (treeEl && previewEl) {
            // Clean up previous instance
            if (datasetBrowser) {
                datasetBrowser.destroy();
                datasetBrowser = null;
            }
            datasetBrowser = new FileBrowser({
                treeContainer: treeEl,
                previewContainer: previewEl,
                vfs: globals.vcs,
                projectBase: tempBase,
                selectable: true,
                onSelectionChange: (selectedPaths: string[]): void => {
                    // Update cost strip
                    const countEl: HTMLElement | null = document.getElementById('gather-selected-count');
                    const costEl: HTMLElement | null = document.getElementById('gather-cost-value');
                    if (countEl) countEl.textContent = String(selectedPaths.length);
                    if (costEl) costEl.textContent = `$${(selectedPaths.length * costPerFile).toFixed(2)}`;
                }
            });
            datasetBrowser.trees_set({ data: dataRoot });
            datasetBrowser.tree_render();
        }
    }

    // 6. Command pills → write into #overlay-command-slot
    const commandSlot: HTMLElement | null = document.getElementById('overlay-command-slot');
    if (commandSlot) {
        commandSlot.style.setProperty('--module-color', 'var(--sky)');
        commandSlot.innerHTML = `
            <button class="pill-btn done-pill" id="dataset-done-btn">
                <span class="btn-text">DONE</span>
            </button>
            <button class="pill-btn additional-data-pill" id="dataset-additional-btn">
                <span class="btn-text">ADD</span>
            </button>
            <button class="pill-btn close-pill" id="dataset-close-btn">
                <span class="btn-text">CANCEL</span>
            </button>
        `;

        document.getElementById('dataset-done-btn')?.addEventListener('click', (e: Event): void => {
            e.stopPropagation();
            datasetDetail_done();
        });

        document.getElementById('dataset-additional-btn')?.addEventListener('click', (e: Event): void => {
            e.stopPropagation();
            datasetDetail_additionalData();
        });

        document.getElementById('dataset-close-btn')?.addEventListener('click', (e: Event): void => {
            e.stopPropagation();
            datasetDetail_close();
        });
    }
}

/**
 * Commits the current dataset selection and closes the overlay.
 * Stores the gathered subtree and marks the dataset tile as gathered.
 */
function datasetDetail_done(): void {
    datasetGather_commit();
    datasetDetail_close();

    if (globals.terminal && activeDetailDataset) {
        globals.terminal.println(`● GATHERED: [${activeDetailDataset.name.toUpperCase()}]`);
        const entry: GatheredEntry | undefined = gatheredDatasets.get(activeDetailDataset.id);
        if (entry) {
            globals.terminal.println(`○ ${entry.selectedPaths.length} FILES SELECTED.`);
        }
    }
}

/**
 * Commits the current dataset selection and returns to the search grid
 * for additional dataset browsing.
 */
function datasetDetail_additionalData(): void {
    datasetGather_commit();
    datasetDetail_close();

    if (globals.terminal && activeDetailDataset) {
        globals.terminal.println(`● GATHERED: [${activeDetailDataset.name.toUpperCase()}]`);
        globals.terminal.println('○ SELECT ADDITIONAL DATASETS TO CONTINUE GATHERING.');
    }
}

/**
 * Commits the current selection from the dataset browser to the gathered map.
 */
function datasetGather_commit(): void {
    if (!datasetBrowser || !activeDetailDataset) return;

    const selectedPaths: string[] = datasetBrowser.selection_get();
    if (selectedPaths.length === 0) return;

    const dataRoot: VcsFileNode = cohortTree_build([activeDetailDataset]);
    const subtree: VcsFileNode | null = datasetBrowser.selectionSubtree_extract(dataRoot);
    if (!subtree) return;

    gatheredDatasets.set(activeDetailDataset.id, {
        dataset: activeDetailDataset,
        selectedPaths,
        subtree
    });

    // If a gather target project is active, merge into its VFS data tree
    if (gatherTargetProject) {
        const projectBase: string = `/home/user/projects/${gatherTargetProject.name}`;
        try { globals.vcs.dir_create(`${projectBase}/data`); } catch { /* exists */ }
        // Mount the gathered subtree under the project's data directory
        const dsDir: string = activeDetailDataset.name.replace(/\s+/g, '_');
        globals.vcs.tree_unmount(`${projectBase}/data/${dsDir}`);
        globals.vcs.tree_mount(`${projectBase}/data/${dsDir}`, subtree);
    }

    // Re-render the dataset grid to show gathered tint
    const container: HTMLElement | null = document.getElementById('dataset-results');
    const card: HTMLElement | null = container?.querySelector(`[data-id="${activeDetailDataset.id}"]`) as HTMLElement;
    if (card) card.classList.add('gathered');
}

/**
 * Closes the dataset detail overlay (no gather commit).
 */
function datasetDetail_close(): void {
    const overlay: HTMLElement | null = document.getElementById('asset-detail-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;

    if (datasetBrowser) {
        datasetBrowser.destroy();
        datasetBrowser = null;
    }

    // Clean up temp VFS mount
    if (activeDetailDataset) {
        const tempBase: string = `/home/user/datasets/${activeDetailDataset.id}`;
        try { globals.vcs.tree_unmount(`${tempBase}/data`); } catch { /* noop */ }
    }

    activeDetailDataset = null;

    // Clear slot contents and reset mode — marketplace originals are untouched
    overlaySlots_clear();
    overlay.dataset.mode = 'marketplace';

    overlay.classList.add('closing');
    overlay.addEventListener('animationend', (): void => {
        overlay.classList.add('hidden');
        overlay.classList.remove('closing');
    }, { once: true });
}

/**
 * Counts total leaf files in a VcsFileNode tree.
 */
function fileCount_total(node: VcsFileNode): number {
    if (!node.children) return 1;
    let count: number = 0;
    for (const child of node.children) {
        count += fileCount_total(child);
    }
    return count;
}

/**
 * Clears the overlay slot containers (sidebar, content, command).
 * The marketplace's original DOM is never touched — mode switching
 * is handled entirely by CSS via the data-mode attribute.
 */
function overlaySlots_clear(): void {
    const sidebarSlot: HTMLElement | null = document.getElementById('overlay-sidebar-slot');
    const contentSlot: HTMLElement | null = document.getElementById('overlay-content-slot');
    const commandSlot: HTMLElement | null = document.getElementById('overlay-command-slot');
    if (sidebarSlot) sidebarSlot.innerHTML = '';
    if (contentSlot) contentSlot.innerHTML = '';
    if (commandSlot) commandSlot.innerHTML = '';
}
