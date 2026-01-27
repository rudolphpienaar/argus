/**
 * @file Search Stage Logic
 * 
 * Handles the dataset catalog, project workspace view, and AI integration.
 * 
 * @module
 */

import { state, globals } from '../state/store.js';
import { DATASETS } from '../data/datasets.js';
import { MOCK_PROJECTS } from '../data/projects.js';
import { stage_advanceTo } from '../logic/navigation.js';
import type { Dataset } from '../models/types.js';
import type { QueryResponse } from '../../lcarslm/types.js';
import { LCARSEngine } from '../../lcarslm/engine.js';

// ============================================================================
// AI / Auth Logic
// ============================================================================

export function lcarslm_initialize(): void {
    const apiKey: string | null = localStorage.getItem('ARGUS_API_KEY');
    const provider: string | null = localStorage.getItem('ARGUS_PROVIDER');
    const model: string | null = localStorage.getItem('ARGUS_MODEL') || 'default';
    
    if (apiKey && provider) {
        globals.lcarsEngine = new LCARSEngine({
            apiKey,
            model: model,
            provider: provider as 'openai' | 'gemini'
        });
        console.log('DEBUG: LCARSEngine initialized and set to globals.', globals.lcarsEngine);
        searchUI_updateState('ready');
        if (globals.terminal) {
            globals.terminal.setStatus(`MODE: [${provider.toUpperCase()}] // MODEL: [${model.toUpperCase()}]`);
            globals.terminal.println(`>> AI CORE LINK ESTABLISHED: PROVIDER [${provider.toUpperCase()}]`);
        }
    } else {
        searchUI_updateState('auth-required');
    }
}

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

export function lcarslm_reset(): void {
    localStorage.removeItem('ARGUS_API_KEY');
    localStorage.removeItem('ARGUS_PROVIDER');
    localStorage.removeItem('ARGUS_OPENAI_KEY');
    globals.lcarsEngine = null;
    searchUI_updateState('auth-required');
}

export function lcarslm_simulate(): void {
    globals.lcarsEngine = new LCARSEngine(null);
    searchUI_updateState('ready');
    if (globals.terminal) {
        globals.terminal.setStatus('MODE: [SIMULATION] // EMULATION ACTIVE');
        globals.terminal.println('>> AI CORE: SIMULATION MODE ACTIVE. EMULATING NEURAL RESPONSES.');
    }
}

function searchUI_updateState(status: 'auth-required' | 'ready'): void {
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

    const filtered: Dataset[] = DATASETS.filter(ds => {
        const matchesQuery: boolean = !query || ds.name.toLowerCase().includes(query.toLowerCase()) || ds.description.toLowerCase().includes(query.toLowerCase());
        const matchesModality: boolean = !modality || ds.modality === modality;
        const matchesAnnotation: boolean = !annotation || ds.annotationType === annotation;
        return matchesQuery && matchesModality && matchesAnnotation;
    });

    const isSearchActive = (query.trim() !== '') || (modality !== '') || (annotation !== '');
    workspace_render(filtered, isSearchActive);
    
    return filtered;
}

export function workspace_render(datasets: Dataset[], isSearchActive: boolean): void {
    const container: HTMLElement | null = document.getElementById('dataset-results');
    if (!container) return;

    // SCENARIO 1: Root View (No Project, No Search) -> Show Projects
    if (!state.activeProject && !isSearchActive) {
        container.innerHTML = MOCK_PROJECTS.map(p => `
            <div class="dataset-card project-card" onclick="project_activate('${p.id}')" style="border-color: var(--honey);">
                <div class="thumbnail" style="background: var(--honey); display: flex; align-items: center; justify-content: center; color: black; font-weight: bold; font-family: 'Antonio'; font-size: 2rem;">DIR</div>
                <h4>${p.name}</h4>
                <div class="meta">
                    <span>PROJECT FOLDER</span>
                    <span>${p.datasets.length} datasets</span>
                    <span>Modified: ${p.lastModified.toLocaleDateString()}</span>
                </div>
            </div>
        `).join('');
        return;
    }

    // SCENARIO 2: Active Project OR Search Results -> Show Datasets
    let headerHtml = '<h2>Available Datasets</h2>';
    if (state.activeProject) {
        headerHtml = `
            <div class="lcars-header-block" style="border-color: var(--canary); margin-bottom: 1rem;">
                <h2 style="margin: 0; color: var(--canary); font-size: 1.5rem;">ACTIVE PROJECT: ${state.activeProject.name}</h2>
                <div class="lcars-subtitle" style="color: var(--harvestgold);">MODIFYING COHORT DEFINITION</div>
            </div>
            ${headerHtml}
        `;
    }

    container.innerHTML = headerHtml + datasets.map(ds => `
        <div class="dataset-card ${state.selectedDatasets.some((s: Dataset) => s.id === ds.id) ? 'selected' : ''}"
             data-id="${ds.id}"
             onclick="dataset_toggle('${ds.id}')">
            <img class="thumbnail" src="${ds.thumbnail}" alt="${ds.name}" onerror="this.style.display='none'">
            <h4>${ds.name}</h4>
            <div class="meta">
                <span>${ds.modality.toUpperCase()} · ${ds.annotationType}</span>
                <span>${ds.imageCount.toLocaleString()} images · ${ds.size}</span>
                <span>${ds.provider}</span>
                <span class="cost">$${ds.cost.toFixed(2)}</span>
            </div>
        </div>
    `).join('');
}

export function dataset_select(datasetId: string, quiet: boolean = false): void {
    const dataset = DATASETS.find(ds => ds.id === datasetId);
    if (!dataset) return;

    const exists = state.selectedDatasets.some(ds => ds.id === datasetId);
    if (!exists) {
        state.selectedDatasets.push(dataset);
        
        // Update UI
        const card = document.querySelector(`.dataset-card[data-id="${datasetId}"]`);
        if (card) card.classList.add('selected');

        if (!quiet && globals.terminal) {
            globals.terminal.println(`● SELECTED DATASET: [${dataset.id}] ${dataset.name}`);
            globals.terminal.println(`○ ADDED TO COHORT BUFFER. SELECT MORE OR PROCEED TO GATHER.`);
        }

        // Update cascading stats
        import('./gather.js').then(m => m.selectionCount_update());
        import('../logic/telemetry.js').then(m => m.cascade_update());
    }
}

export function dataset_deselect(datasetId: string, quiet: boolean = false): void {
    const index = state.selectedDatasets.findIndex(ds => ds.id === datasetId);
    if (index >= 0) {
        const dataset = state.selectedDatasets[index];
        state.selectedDatasets.splice(index, 1);

        // Update UI
        const card = document.querySelector(`.dataset-card[data-id="${datasetId}"]`);
        if (card) card.classList.remove('selected');

        if (!quiet && globals.terminal) {
            globals.terminal.println(`○ DESELECTED DATASET: [${datasetId}] ${dataset.name}`);
        }

        // Update cascading stats
        import('./gather.js').then(m => m.selectionCount_update());
        import('../logic/telemetry.js').then(m => m.cascade_update());
    }
}

export function dataset_toggle(datasetId: string): void {
    const exists = state.selectedDatasets.some(ds => ds.id === datasetId);
    if (exists) {
        dataset_deselect(datasetId);
    } else {
        dataset_select(datasetId);
    }
}

export function project_activate(projectId: string): void {
    const project = MOCK_PROJECTS.find(p => p.id === projectId);
    if (!project) return;

    state.activeProject = project;
    state.selectedDatasets = [...project.datasets];
    
    if (globals.terminal) {
        globals.terminal.setPrompt(`ARGUS: ~/${project.name} >`);
        globals.terminal.println(`● MOUNTING PROJECT: [${project.name.toUpperCase()}]`);
        globals.terminal.println(`○ LOADED ${project.datasets.length} DATASETS.`);
    }

    workspace_render(DATASETS, false);
    import('../logic/telemetry.js').then(m => m.cascade_update());
}
