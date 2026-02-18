/**
 * @file Gather Stage View Templates
 *
 * Pure rendering helpers for Gather-stage HTML generation.
 *
 * Responsibilities:
 * - Generate project strip markup.
 * - Generate dataset workspace markup for search and gathered assets.
 * - Generate reusable overlay section templates for project/dataset detail.
 *
 * Non-responsibilities:
 * - DOM querying, event listener registration, or side effects.
 * - Store/VFS mutations and stage transitions.
 *
 * @module core/stages/gather/ui/view
 */

import type { Dataset, Project } from '../../../models/types.js';
import { render_assetCard, type AssetCardOptions } from '../../../../ui/components/AssetCard.js';

/**
 * Data required to render the Gather workspace card grid.
 */
export interface WorkspaceRenderModel {
    searchResults: Dataset[];
    gatheredDatasets: Dataset[];
    gatheredDatasetIds: ReadonlySet<string>;
    isQueryActive: boolean;
}

/**
 * Render project strip chips and the "new draft" action chip.
 */
export function projectStripHtml_render(
    projects: ReadonlyArray<Project>,
    activeProjectId: string | null,
): string {
    const chipsHtml: string = projects.map((project: Project): string => {
        const isActive: boolean = activeProjectId !== null && activeProjectId === project.id;
        const datasetCount: number = project.datasets.length;
        return `<div class="project-chip${isActive ? ' active' : ''}" data-id="${project.id}">
                    ${project.name.toUpperCase()}
                    <span class="chip-badge">${datasetCount}DS</span>
                </div>`;
    }).join('');

    return `<span class="project-strip-header">PROJECTS</span>${chipsHtml}<div class="project-chip new-project">+ NEW</div>`;
}

/**
 * Render Gather-stage dataset workspace content.
 */
export function workspaceHtml_render(model: WorkspaceRenderModel): string {
    const gatheredMissing: Dataset[] = model.gatheredDatasets.filter((dataset: Dataset): boolean => {
        return !model.searchResults.some((result: Dataset): boolean => result.id === dataset.id);
    });

    let html: string = '';

    if (gatheredMissing.length > 0) {
        html += `<div style="grid-column: 1 / -1; margin-top: 1rem; margin-bottom: 0.5rem; border-bottom: 1px solid var(--honey); color: var(--honey); font-family: 'Antonio', sans-serif; letter-spacing: 1px;">WORKSPACE ASSETS</div>`;
        html += datasetCardsHtml_render(gatheredMissing, model.gatheredDatasetIds);
        if (model.searchResults.length > 0) {
            html += `<div style="grid-column: 1 / -1; margin-top: 2rem; margin-bottom: 0.5rem; border-bottom: 1px solid var(--sky); color: var(--sky); font-family: 'Antonio', sans-serif; letter-spacing: 1px;">SEARCH RESULTS</div>`;
        }
    }

    if (model.searchResults.length > 0) {
        html += datasetCardsHtml_render(model.searchResults, model.gatheredDatasetIds);
        return html;
    }

    if (gatheredMissing.length === 0 && !model.isQueryActive) {
        return `
            <div style="text-align: center; padding: 3rem 1rem; color: var(--font-color); opacity: 0.6; grid-column: 1 / -1;">
                <p style="font-size: 1.1rem;">USE THE AI CORE TO SEARCH FOR DATASETS</p>
                <p style="font-size: 0.85rem; color: var(--harvestgold);">OR SELECT A PROJECT ABOVE TO OPEN AN EXISTING WORKSPACE</p>
            </div>
        `;
    }

    return `
        <div style="text-align: center; padding: 3rem 1rem; color: var(--font-color); opacity: 0.6; grid-column: 1 / -1;">
            <p style="font-size: 1.1rem;">NO MATCHING DATASETS FOUND</p>
        </div>
    `;
}

/**
 * Render project-detail browser section content.
 */
export function projectDetailContentHtml_render(project: Project): string {
    return `
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
}

/**
 * Render template selector panel for uninitialized projects.
 */
export function projectTemplateSelectorHtml_render(projectName: string): string {
    return `
        <div class="template-selector" style="padding: 20px;">
            <h2 style="color: var(--honey); margin-bottom: 10px;">SELECT WORKFLOW ARCHITECTURE</h2>
            <p style="margin-bottom: 20px; color: var(--font-color);">Initialize [${projectName}] with a development template:</p>
            
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
}

/**
 * Render dataset-detail browser section content.
 */
export function datasetDetailContentHtml_render(totalFiles: number): string {
    return `
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
}

/**
 * Render dataset cards for the Gather-stage grid.
 */
function datasetCardsHtml_render(
    datasets: ReadonlyArray<Dataset>,
    gatheredDatasetIds: ReadonlySet<string>,
): string {
    return datasets.map((dataset: Dataset): string => {
        const isGathered: boolean = gatheredDatasetIds.has(dataset.id);
        const options: AssetCardOptions = {
            id: dataset.id,
            type: 'dataset',
            title: dataset.name.toUpperCase(),
            description: dataset.description,
            metaLeft: dataset.provider,
            metaRight: `${dataset.imageCount.toLocaleString()} IMAGES · ${dataset.size}`,
            badgeText: `${dataset.modality.toUpperCase()} · ${dataset.annotationType.toUpperCase()}`,
            badgeRightText: `$${dataset.cost.toFixed(2)}`,
            isInstalled: isGathered,
            onClick: `datasetDetail_open('${dataset.id}')`,
            actionButton: {
                label: isGathered ? 'GATHERED' : 'ADD',
                activeLabel: 'GATHERED',
                onClick: isGathered ? `datasetDetail_open('${dataset.id}')` : `dataset_add('${dataset.id}')`,
                isActive: isGathered,
            },
        };
        return render_assetCard(options);
    }).join('');
}
