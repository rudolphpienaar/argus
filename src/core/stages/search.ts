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
import { ai_greeting } from '../../lcarslm/AIService.js';
import { render_assetCard, type AssetCardOptions } from '../../ui/components/AssetCard.js';
import { FileBrowser } from '../../ui/components/FileBrowser.js';
import { overlaySlots_clear } from '../logic/OverlayUtils.js';
import { resizeHandle_attach } from '../../ui/interactions/ResizeHandle.js';
import { files_prompt, files_ingest } from '../logic/FileUploader.js';
import { projectContext_get } from '../logic/ProjectContext.js';
import { SYSTEM_KNOWLEDGE } from '../data/knowledge.js';

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
        }, SYSTEM_KNOWLEDGE);
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
    globals.lcarsEngine = new LCARSEngine(null, SYSTEM_KNOWLEDGE);
    searchUIState_set('ready');
    if (globals.terminal) {
        globals.terminal.setStatus('MODE: [SIMULATION] // EMULATION ACTIVE');
        // Trigger Calypso startup sequence
        ai_greeting();
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
 * @param datasets - The datasets to display (search results).
 * @param isSearchActive - Whether any search filter is currently active.
 */
export function workspace_render(datasets: Dataset[], isSearchActive: boolean): void {
    // Always render the persistent project strip
    projectStrip_render();

    const container: HTMLElement | null = document.getElementById('dataset-results');
    if (!container) return;

    // 1. Identify gathered datasets that are NOT in the current search results
    const gatheredMissing: Dataset[] = [];
    gatheredDatasets.forEach((entry) => {
        if (!datasets.some(ds => ds.id === entry.dataset.id)) {
            gatheredMissing.push(entry.dataset);
        }
    });

    // Helper to render a list of datasets
    const renderList = (list: Dataset[]): string => list.map((ds: Dataset): string => {
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
                label: isGathered ? 'GATHERED' : 'ADD',
                activeLabel: 'GATHERED',
                onClick: isGathered ? `datasetDetail_open('${ds.id}')` : `dataset_add('${ds.id}')`,
                isActive: isGathered
            }
        };
        return render_assetCard(opts);
    }).join('');

    let html = '';

    // 2. Render Workspace Assets (if any)
    if (gatheredMissing.length > 0) {
        html += `<div style="grid-column: 1 / -1; margin-top: 1rem; margin-bottom: 0.5rem; border-bottom: 1px solid var(--honey); color: var(--honey); font-family: 'Antonio', sans-serif; letter-spacing: 1px;">WORKSPACE ASSETS</div>`;
        html += renderList(gatheredMissing);
        
        if (datasets.length > 0) {
             html += `<div style="grid-column: 1 / -1; margin-top: 2rem; margin-bottom: 0.5rem; border-bottom: 1px solid var(--sky); color: var(--sky); font-family: 'Antonio', sans-serif; letter-spacing: 1px;">SEARCH RESULTS</div>`;
        }
    }

    // 3. Render Search Results
    if (datasets.length > 0) {
        html += renderList(datasets);
    } else if (gatheredMissing.length === 0 && !isSearchActive) {
        // Empty state (no gathered, no search results, no search active)
        html = `
            <div style="text-align: center; padding: 3rem 1rem; color: var(--font-color); opacity: 0.6; grid-column: 1 / -1;">
                <p style="font-size: 1.1rem;">USE THE AI CORE TO SEARCH FOR DATASETS</p>
                <p style="font-size: 0.85rem; color: var(--harvestgold);">OR SELECT A PROJECT ABOVE TO OPEN AN EXISTING WORKSPACE</p>
            </div>
        `;
    } else if (datasets.length === 0 && gatheredMissing.length === 0) {
        // Search active but no results
         html = `
            <div style="text-align: center; padding: 3rem 1rem; color: var(--font-color); opacity: 0.6; grid-column: 1 / -1;">
                <p style="font-size: 1.1rem;">NO MATCHING DATASETS FOUND</p>
            </div>
        `;
    }

    container.innerHTML = html;

    // Apply gathered class to cards (in case renderList logic didn't catch it, though it should have)
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
    if (!strip) {
        console.error('ARGUS: project-strip element not found in DOM');
        return;
    }

    console.log('ARGUS: Rendering project strip. Project count:', MOCK_PROJECTS.length);

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
        console.log('ARGUS: + NEW clicked');
        // Immediate Draft Creation
        const timestamp = Date.now();
        const shortId = timestamp.toString().slice(-4);
        const draftProject: Project = {
            id: `draft-${timestamp}`,
            name: `DRAFT-${shortId}`,
            description: 'New project workspace',
            created: new Date(),
            lastModified: new Date(),
            datasets: []
        };

        MOCK_PROJECTS.push(draftProject);
        gatherTargetProject = draftProject;
        console.log('ARGUS: Created draft project:', draftProject);

        // Mount in VFS and activate context
        const projectBase: string = `/home/user/projects/${draftProject.name}`;
        // Create clean project root only - NO BOILERPLATE
        globals.vcs.dir_create(projectBase);

        if (globals.shell) {
            globals.shell.command_execute(`cd ${projectBase}`);
            globals.shell.env_set('PROJECT', draftProject.name);
            if (globals.terminal) globals.terminal.prompt_sync();
        }
        
        projectStrip_render();
        
        if (globals.terminal) {
            globals.terminal.println(`● NEW PROJECT INITIALIZED: [${draftProject.name}].`);
            globals.terminal.println(`○ CONTEXT SWITCHED TO ${projectBase}`);
            globals.terminal.println(`○ TYPE "upload" TO INGEST LOCAL FILES OR CONTINUE SEARCHING.`);
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

    store.dataset_select(dataset);

    // Update UI
    const card: Element | null = document.querySelector(`.market-card[data-id="${datasetId}"]`);
    if (card) card.classList.add('selected');

    if (!quiet && globals.terminal) {
        globals.terminal.println(`● SELECTED DATASET: [${dataset.id}] ${dataset.name}`);
        globals.terminal.println(`○ ADDED TO COHORT BUFFER. SELECT MORE OR PROCEED TO CODE.`);
    }
}

/**
 * Deselects a dataset by ID and removes it from the cohort buffer.
 *
 * @param datasetId - The dataset identifier.
 * @param quiet - If true, suppresses terminal output.
 */
export function dataset_deselect(datasetId: string, quiet: boolean = false): void {
    const dataset: Dataset | undefined = DATASETS.find((ds: Dataset): boolean => ds.id === datasetId);
    if (!dataset) return;

    store.dataset_deselect(datasetId);

    // Update UI
    const card: Element | null = document.querySelector(`.market-card[data-id="${datasetId}"]`);
    if (card) card.classList.remove('selected');

    if (!quiet && globals.terminal) {
        globals.terminal.println(`○ DESELECTED DATASET: [${datasetId}] ${dataset.name}`);
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
        
        // Restore the Intelligence Console (Terminal) so user can continue searching
        if (globals.frameSlot && !globals.frameSlot.state_isOpen()) {
            globals.frameSlot.frame_open();
        }
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

/**
 * Returns the current gather target project.
 */
export function gatherTargetProject_get(): Project | null {
    return gatherTargetProject;
}

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
    const paths = projectContext_get(project);
    const projectBase = paths.root;

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

    // 2. Build file trees from ACTUAL VFS STATE
    
    // Ensure the project exists in VFS
    if (!globals.vcs.node_stat(projectBase)) {
        globals.vcs.dir_create(projectBase);
    }

    const trees: Record<string, VcsFileNode> = {};
    const tabs: Array<{ id: string; label: string; shade: number }> = [];

    // Always include ROOT view
    const rootNode = vfsTree_build(projectBase);
    if (rootNode) {
        trees.root = rootNode;
        tabs.push({ id: 'root', label: 'ROOT', shade: 1 });
    }

    // Optional: SOURCE
    const srcNode = vfsTree_build(paths.src);
    if (srcNode) {
        trees.source = srcNode;
        tabs.push({ id: 'source', label: 'SOURCE', shade: 2 });
    }

    // Optional: INPUT (formerly data)
    // Check for 'input' first, fallback to 'data' for legacy compatibility
    let inputPath = paths.input;
    if (!globals.vcs.node_stat(inputPath) && globals.vcs.node_stat(`${paths.root}/data`)) {
        inputPath = `${paths.root}/data`;
    }
    const inputNode = vfsTree_build(inputPath);
    if (inputNode) {
        trees.input = inputNode;
        tabs.push({ id: 'input', label: 'INPUT', shade: 3 });
    }

    // Optional: OUTPUT
    const outputNode = vfsTree_build(paths.output);
    if (outputNode) {
        trees.output = outputNode;
        tabs.push({ id: 'output', label: 'OUTPUT', shade: 1 });
    }

    // Default active tab: ROOT is usually the safest default now
    let activeTab: string = 'root';

    // 4. Sidebar → write into #overlay-sidebar-slot
    const sidebarSlot: HTMLElement | null = document.getElementById('overlay-sidebar-slot');
    if (sidebarSlot) {
        sidebarSlot.innerHTML = '';

        tabs.forEach((tab): void => {
            const panel: HTMLAnchorElement = document.createElement('a');
            panel.className = 'lcars-panel';
            panel.href = `#${tab.id}`;
            panel.textContent = tab.label;
            panel.dataset.panelId = tab.id;
            panel.dataset.shade = String(tab.shade);
            if (tab.id === activeTab) panel.classList.add('active');

            panel.addEventListener('click', (e: Event): void => {
                e.preventDefault();
                activeTab = tab.id;
                sidebarSlot.querySelectorAll<HTMLElement>('.lcars-panel').forEach((p: HTMLElement): void => {
                    p.classList.toggle('active', p.dataset.panelId === tab.id);
                });
                if (detailBrowser) detailBrowser.tab_switch(tab.id);

                // Sync terminal pwd
                if (isWorkspaceExpanded && workspaceProjectBase) {
                    let targetPath = workspaceProjectBase;
                    if (tab.id === 'source') targetPath += '/src';
                    else if (tab.id === 'input') targetPath += '/input';
                    else if (tab.id === 'output') targetPath += '/output';
                    
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

    // 6. Command pills → write UPLOAD, RENAME, CLOSE, OPEN
    const commandSlot: HTMLElement | null = document.getElementById('overlay-command-slot');
    if (commandSlot) {
        commandSlot.style.setProperty('--module-color', 'var(--honey)');
        commandSlot.innerHTML = `
            <button class="pill-btn additional-data-pill" id="project-upload-btn" style="margin-bottom: 0;">
                <span class="btn-text">UPLOAD</span>
            </button>
            <button class="pill-btn additional-data-pill" id="project-rename-btn">
                <span class="btn-text">RENAME</span>
            </button>
            <button class="pill-btn close-pill" id="project-close-btn">
                <span class="btn-text">CLOSE</span>
            </button>
            <button class="pill-btn install-pill" id="project-code-btn">
                <span class="btn-text">CODE</span>
            </button>
        `;

        document.getElementById('project-upload-btn')?.addEventListener('click', async (e: Event): Promise<void> => {
            e.stopPropagation();
            try {
                const files = await files_prompt();
                if (files.length === 0) return;

                // Ingest into project root (or specific folder if we tracked active tab/folder)
                // For now, project root is the most predictable 'Just a Folder' behavior.
                const count = await files_ingest(files, projectBase);
                
                if (globals.terminal) {
                    globals.terminal.println(`● UPLOAD COMPLETE: ${count} FILES ADDED TO [${project.name}].`);
                }

                // Refresh view to show new files
                projectDetail_populate(project, projectId, overlay, lcarsFrame);
            } catch (err) {
                console.error('Upload failed', err);
            }
        });

        document.getElementById('project-rename-btn')?.addEventListener('click', (e: Event): void => {
            e.stopPropagation();
            project_rename_interact(project);
        });

        document.getElementById('project-close-btn')?.addEventListener('click', (): void => {
            projectDetail_close();
        });

        document.getElementById('project-code-btn')?.addEventListener('click', (e: Event): void => {
            e.stopPropagation();
            // Check if src already exists. If yes, skip selection.
            if (globals.vcs.node_stat(`${projectBase}/src`)) {
                workspace_expand(projectId, project);
            } else {
                workspace_interactInitialize(projectId, project);
            }
        });
    }
}

/**
 * Handles workflow template selection.
 * Called from the UI when a user chooses a template.
 */
export function template_select(projectId: string, type: 'fedml' | 'chris'): void {
    const project = MOCK_PROJECTS.find(p => p.id === projectId);
    if (!project) return;

    // Populate project structure
    const username = globals.shell?.env_get('USER') || 'user';
    projectDir_populate(globals.vcs, username, project.name);
    
    // Expand workspace
    workspace_expand(projectId, project);
}

/**
 * Shows the LCARS intermediate UI for selecting a project template.
 */
function workspace_interactInitialize(projectId: string, project: Project): void {
    const contentSlot: HTMLElement | null = document.getElementById('overlay-content-slot');
    if (!contentSlot) return;

    contentSlot.innerHTML = `
        <div class="template-selector" style="padding: 20px;">
            <h2 style="color: var(--honey); margin-bottom: 10px;">SELECT WORKFLOW ARCHITECTURE</h2>
            <p style="margin-bottom: 20px; color: var(--font-color);">Initialize [${project.name}] with a development template:</p>
            
            <div class="template-grid" style="display: flex; gap: 20px;">
                <div class="template-card" style="flex: 1; border: 2px solid var(--honey); border-radius: 0 0 20px 0; padding: 15px;">
                    <div class="card-header" style="font-weight: bold; margin-bottom: 10px; color: var(--honey);">FEDERATED LEARNING TASK</div>
                    <div class="card-body" style="margin-bottom: 15px; font-size: 0.9em; color: var(--font-color);">
                        Standard SeaGaP-MP workflow. Includes <code>train.py</code> scaffold for distributed execution across Trusted Domains.
                    </div>
                    <button id="btn-tmpl-fedml" class="lcars-btn" style="background: var(--honey); color: black; border: none; padding: 10px 20px; font-weight: bold; cursor: pointer; border-radius: 15px; width: 100%; text-align: right;">SELECT</button>
                </div>

                <div class="template-card" style="flex: 1; border: 2px solid var(--sky); border-radius: 0 0 20px 0; padding: 15px;">
                    <div class="card-header" style="font-weight: bold; margin-bottom: 10px; color: var(--sky);">CHRIS PLUGIN (APP)</div>
                    <div class="card-body" style="margin-bottom: 15px; font-size: 0.9em; color: var(--font-color);">
                        Containerized application for the ChRIS platform. Includes <code>Dockerfile</code> and argument parsers.
                    </div>
                    <button id="btn-tmpl-chris" class="lcars-btn" style="background: var(--sky); color: black; border: none; padding: 10px 20px; font-weight: bold; cursor: pointer; border-radius: 15px; width: 100%; text-align: right;">SELECT</button>
                </div>
            </div>
        </div>
    `;

    // Attach listeners explicitly to avoid window binding issues
    setTimeout(() => {
        document.getElementById('btn-tmpl-fedml')?.addEventListener('click', () => template_select(projectId, 'fedml'));
        document.getElementById('btn-tmpl-chris')?.addEventListener('click', () => template_select(projectId, 'chris'));
    }, 0);
}

/**
 * Handles the project rename workflow via UI interaction.
 * Prompts user, then calls project_rename.
 */
function project_rename_interact(project: Project): void {
    const oldName = project.name;
    const newNameRaw = prompt('ENTER NEW PROJECT NAME:', oldName);
    
    if (!newNameRaw || newNameRaw === oldName) return;
    
    // Sanitize: allow alphanumeric, underscore, hyphen
    const newName = newNameRaw.replace(/[^a-zA-Z0-9-_]/g, '');
    if (!newName) {
        alert('Invalid name. Use alphanumeric characters only.');
        return;
    }

    project_rename(project, newName);
}

/**
 * Performs the actual rename operation: moves VFS directory, 
 * updates model, syncs shell context, and refreshes UI.
 * 
 * @param project - The project to rename.
 * @param newName - The new name (sanitized).
 */
export function project_rename(project: Project, newName: string): void {
    const oldName = project.name;
    const username = globals.shell?.env_get('USER') || 'user';
    const oldPath = `/home/${username}/projects/${oldName}`;
    const newPath = `/home/${username}/projects/${newName}`;

    try {
        // 1. Move VFS directory
        if (globals.vcs.node_stat(oldPath)) {
            globals.vcs.node_move(oldPath, newPath);
        } else {
            globals.vcs.dir_create(newPath);
            globals.vcs.dir_create(`${newPath}/src`);
            globals.vcs.dir_create(`${newPath}/input`);
            globals.vcs.dir_create(`${newPath}/output`);
        }

        // 2. Update Project Model
        project.name = newName;

        // 3. Update Shell Context if active
        const shellProject = globals.shell?.env_get('PROJECT');
        if (shellProject === oldName) {
            globals.shell?.env_set('PROJECT', newName);
            const currentCwd = globals.vcs.cwd_get();
            if (currentCwd.startsWith(oldPath)) {
                const newCwd = currentCwd.replace(oldPath, newPath);
                globals.shell?.command_execute(`cd ${newCwd}`);
            }
        }

        // 4. UI Refresh
        projectStrip_render();
        
        const nameEl: HTMLElement | null = document.getElementById('detail-name');
        if (nameEl) nameEl.textContent = newName.toUpperCase();
        
        const overlay = document.getElementById('asset-detail-overlay');
        const lcarsFrame = document.getElementById('detail-lcars-frame');
        if (overlay && lcarsFrame && !overlay.classList.contains('hidden')) {
            projectDetail_populate(project, project.id, overlay, lcarsFrame);
        }

        if (globals.terminal) {
            globals.terminal.println(`● PROJECT RENAMED: [${oldName}] -> [${newName}]`);
            globals.terminal.println(`○ VFS PATH MOVED TO ${newPath}`);
            globals.terminal.prompt_sync();
        }

    } catch (e: unknown) {
        console.error('Rename failed', e);
        if (typeof alert === 'function') {
            alert(`Rename failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
}

/**
 * Recursively builds a FileNode tree from the VFS.
 * Used to mirror actual VFS state (including uploads) in the UI.
 */
function vfsTree_build(path: string): VcsFileNode | null {
    try {
        const node = globals.vcs.node_stat(path);
        if (!node) return null;

        // If it's a folder, we must populate children via dir_list
        // node_stat returns the node metadata but children might be null/stale
        // depending on how node_stat is implemented (usually assumes VFS structure).
        // Best to use dir_list to get fresh children.
        if (node.type === 'folder') {
            const children = globals.vcs.dir_list(path);
            const populatedChildren = children.map(child => vfsTree_build(child.path)).filter((n): n is VcsFileNode => n !== null);
            return {
                ...node,
                children: populatedChildren
            };
        }
        
        return node;
    } catch {
        return null;
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

    const paths = projectContext_get(project);
    workspaceProjectBase = paths.root;

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
    workspaceDragCleanup = resizeHandle_attach({
        target: consoleEl,
        handle: termHandle,
        minSize: 80,
        direction: 'vertical'
    });

    browserDragCleanup = resizeHandle_attach({
        target: overlay,
        handle: browserHandle,
        minSize: 300,
        direction: 'vertical'
    });

    // Phase 2: Terminal activation (after layout transition settles)
    setTimeout((): void => {
        // Load project into store + VFS
        store.project_load(project);

        const cohortRoot: VcsFileNode = cohortTree_build(project.datasets);
        try { globals.vcs.dir_create(paths.input); } catch {}
        
        globals.vcs.tree_unmount(paths.input);
        globals.vcs.dir_create(paths.src);
        globals.vcs.tree_mount(paths.input, cohortRoot);
        globals.vcs.cwd_set(paths.root);

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

        workspace_federalizeButtonAdd();
    }, 400);
}

/**
 * Adds a FEDERALIZE AND LAUNCH button to the workspace content area.
 */
function workspace_federalizeButtonAdd(): void {
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
    if (relative === '/input' || relative.startsWith('/input/')) return 'input';
    if (relative === '/data' || relative.startsWith('/data/')) return 'input';
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
    const username = globals.shell?.env_get('USER') || 'user';
    const tempBase: string = `/home/${username}/datasets/${dataset.id}`;
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
 * Internal logic to commit a gathered dataset (subtree) to the project.
 */
function gather_execute(dataset: Dataset, subtree: VcsFileNode, selectedPaths: string[] = []): void {
    gatheredDatasets.set(dataset.id, {
        dataset,
        selectedPaths,
        subtree
    });

    // Auto-create draft project if none active
    if (!gatherTargetProject) {
        console.log('ARGUS: Auto-creating draft project from gather action');
        const timestamp = Date.now();
        const shortId = timestamp.toString().slice(-4);
        const draftProject: Project = {
            id: `draft-${timestamp}`,
            name: `DRAFT-${shortId}`,
            description: 'New project workspace',
            created: new Date(),
            lastModified: new Date(),
            datasets: []
        };
        MOCK_PROJECTS.push(draftProject);
        gatherTargetProject = draftProject;
        
        // Refresh strip to show new draft
        projectStrip_render();

        // Mount in VFS and activate context
        const paths = projectContext_get(draftProject);
        // Create clean project root only - NO BOILERPLATE
        globals.vcs.dir_create(paths.root);

        if (globals.shell) {
            globals.shell.command_execute(`cd ${paths.root}`);
            globals.shell.env_set('PROJECT', draftProject.name);
            if (globals.terminal) globals.terminal.prompt_sync();
        }
        
        if (globals.terminal) {
            globals.terminal.println('<span class="muthur-text">NO ACTIVE PROJECT DETECTED.</span>');
            globals.terminal.println(`<span class="muthur-text">INITIATING NEW DRAFT WORKSPACE [${draftProject.name}].</span>`);
            globals.terminal.println('<span class="muthur-text">COHORT MOUNTED.</span>');
        }
    }

    // Add dataset to project model (for UI count) if not already present
    const alreadyLinked = gatherTargetProject.datasets.some(ds => ds.id === dataset.id);
    if (!alreadyLinked) {
        gatherTargetProject.datasets.push(dataset);
    }

    // Sync global selection state for the bottom counter
    console.log('ARGUS: Syncing selection state for dataset:', dataset.id);
    store.dataset_select(dataset);

    // Mount into Project VFS
    const paths = projectContext_get(gatherTargetProject);
    try { globals.vcs.dir_create(paths.input); } catch { /* exists */ }
    
    // Mount the gathered subtree
    const dsDir: string = dataset.name.replace(/\s+/g, '_');
    globals.vcs.tree_unmount(`${paths.input}/${dsDir}`);
    globals.vcs.tree_mount(`${paths.input}/${dsDir}`, subtree);

    // Update UI Card
    const card = document.querySelector(`.market-card[data-id="${dataset.id}"]`);
    if (card) {
        card.classList.add('gathered');
        const btn = card.querySelector('.install-btn');
        if (btn) {
            btn.classList.add('installed');
            const btnText = btn.querySelector('.btn-text');
            if (btnText) btnText.textContent = 'GATHERED';
        }
    }
}

/**
 * Public handler for "ADD" button on dataset tiles.
 * Gathers the *entire* dataset immediately.
 */
export function dataset_add(datasetId: string): void {
    const dataset = DATASETS.find(ds => ds.id === datasetId);
    if (!dataset) return;

    if (gatheredDatasets.has(datasetId)) {
        // Already gathered, treat as open detail
        datasetDetail_open(datasetId);
        return;
    }

    // Build full tree
    const dataRoot: VcsFileNode = cohortTree_build([dataset]);
    
    gather_execute(dataset, dataRoot);
    
    if (globals.terminal) {
        globals.terminal.println(`● GATHERED: [${dataset.id}] ${dataset.name}`);
        globals.terminal.println(`○ FULL DATASET MOUNTED.`);
    }
}

/**
 * Commits the current selection from the dataset browser to the gathered map.
 * If no files are manually selected, defaults to adding the ENTIRE dataset.
 */
function datasetGather_commit(): void {
    if (!datasetBrowser || !activeDetailDataset) return;

    const dataRoot: VcsFileNode = cohortTree_build([activeDetailDataset]);
    let subtree: VcsFileNode | null = null;
    let selectedPaths: string[] = datasetBrowser.selection_get();

    if (selectedPaths.length === 0) {
        // Fallback: No manual selection -> Add Everything
        subtree = dataRoot;
    } else {
        // Partial selection
        subtree = datasetBrowser.selectionSubtree_extract(dataRoot);
    }

    if (!subtree) return;

    gather_execute(activeDetailDataset, subtree, selectedPaths);

    // Close overlay
    datasetDetail_done();
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
        const username = globals.shell?.env_get('USER') || 'user';
        const tempBase: string = `/home/${username}/datasets/${activeDetailDataset.id}`;
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

        // Restore the Intelligence Console (Terminal)
        if (globals.frameSlot && !globals.frameSlot.state_isOpen()) {
            globals.frameSlot.frame_open();
        }
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

// ============================================================================
// Lifecycle Hooks
// ============================================================================

/**
 * Transition from the Search/Gather stage to the Process (Code) stage.
 * Activated by the "CODE" pill at the bottom of the Search screen or AI "proceed" command.
 */
export async function proceedToCode_handle(): Promise<void> {
    if (gatherTargetProject) {
        const isDraft = gatherTargetProject.name.startsWith('DRAFT-');
        
        if (isDraft && globals.terminal) {
            globals.terminal.println('<span class="warn">● DRAFT STATUS DETECTED.</span>');
            globals.terminal.println('○ BEFORE PROCEEDING, CONSIDER GIVING THIS COHORT A DESCRIPTIVE NAME.');
            globals.terminal.println('○ CLICK "RENAME" IN THE PROJECT DETAIL OR USE THE AI COMMAND.');
            
            // Allow user to see the warning before opening the detail overlay
            setTimeout(() => {
                projectDetail_open(gatherTargetProject!.id);
                setTimeout(() => {
                    workspace_interactInitialize(gatherTargetProject!.id, gatherTargetProject!);
                }, 100);
            }, 2000);
            return;
        }

        const username = globals.shell?.env_get('USER') || 'user';
        const projectBase = `/home/${username}/projects/${gatherTargetProject.name}`;
        
        // Automatic Heterogeneity Check
        if (globals.terminal) {
            try {
                const { cohort_validate } = await import('../analysis/CohortProfiler.js');
                const validation = cohort_validate(globals.vcs, `${projectBase}/input`);
                
                if (validation.isMixedModality) {
                    globals.terminal.println('<span class="error">● WARNING: MIXED MODALITIES DETECTED.</span>');
                    globals.terminal.println('<span class="warn">○ THIS COHORT CONTAINS INCOMPATIBLE DATA TYPES (NON-IID).</span>');
                    globals.terminal.println('○ FEDERATED TRAINING MAY DIVERGE. REVIEW COHORT VIA "analyze cohort".');
                    
                    // Pause for impact
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            } catch (e) { /* ignore analysis errors during transition */ }
        }

        // Check if src already exists (initialized)
        if (globals.vcs.node_stat(`${projectBase}/src`)) {
            project_activate(gatherTargetProject.id);
        } else {
            // Not initialized -> Open Project Detail -> Prompt Init
            projectDetail_open(gatherTargetProject.id);
            // Delay slightly to allow population to finish, then overlay init
            setTimeout(() => {
                workspace_interactInitialize(gatherTargetProject!.id, gatherTargetProject!);
            }, 100);
        }
    } else {
        if (globals.terminal) {
            globals.terminal.println('<span class="warn">● WARNING: NO ACTIVE PROJECT CONTEXT.</span>');
            globals.terminal.println('○ SELECT AN EXISTING PROJECT OR CLICK "+ NEW" BEFORE PROCEEDING TO CODE.');
        }
    }
}

/**
 * Wrapper for project_rename to satisfy AI Service expectations.
 */
export function project_rename_execute(project: Project, newName: string): void {
    project_rename(project, newName);
}

/**
 * Hook called when entering the Search stage.
 * Opens the terminal frame automatically.
 */
export function stage_enter(): void {
    if (globals.frameSlot) {
        setTimeout(() => { 
            globals.frameSlot?.frame_open(); 
            // Trigger Calypso greeting after frame opens
            setTimeout(ai_greeting, 800);
        }, 10);
    }
}

/**
 * Hook called when exiting the Search stage.
 * No-op for now.
 */
export function stage_exit(): void {
    // Teardown logic if needed
}

