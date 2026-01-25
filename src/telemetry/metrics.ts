/**
 * @file Metrics Dashboard Generator
 * Handles the display of aggregated stats (Datasets, Images, Cost) for Search/Gather stages.
 */

import type { Dataset, CostEstimate } from '../core/models/types.js';

interface RevolvingStat {
    label: string;
    value: string;
}

let tickerInterval: number | null = null;
let tickerIndex: number = 0;

/**
 * Stops any active ticker animation.
 */
export function ticker_stop(): void {
    if (tickerInterval) {
        clearInterval(tickerInterval);
        tickerInterval = null;
    }
}

/**
 * Renders the metrics dashboard for the Search stage (Global Stats + Revolving Ticker + Selection count).
 */
export function searchMetrics_render(selectedDatasets: Dataset[]): void {
    const datasetsEl: HTMLElement | null = document.getElementById('cascade-datasets');
    const imagesEl: HTMLElement | null = document.getElementById('cascade-images');
    const costEl: HTMLElement | null = document.getElementById('cascade-cost');
    const statusEl: HTMLElement | null = document.getElementById('cascade-status');

    const label1: HTMLElement | null = document.getElementById('cascade-label-1');
    const label2: HTMLElement | null = document.getElementById('cascade-label-2');
    const label3: HTMLElement | null = document.getElementById('cascade-label-3');
    const label4: HTMLElement | null = document.getElementById('cascade-label-4');

    if (label1) label1.textContent = 'TOTAL DATASETS';
    if (label2) label2.textContent = 'TOTAL IMAGES';
    if (label3) label3.textContent = 'MODALITY';
    if (label4) label4.textContent = 'YOUR SELECTION';

    if (datasetsEl) datasetsEl.textContent = '14,203';
    if (imagesEl) imagesEl.textContent = '45.2M';
    if (statusEl) statusEl.textContent = selectedDatasets.length.toString();

    // Start Revolving Stats Ticker for Col 3
    const revolvingStats: RevolvingStat[] = [
        { label: 'MODALITY', value: 'MRI: 12K' },
        { label: 'MODALITY', value: 'CT: 8.5K' },
        { label: 'MODALITY', value: 'X-RAY: 15K' },
        { label: 'PATHOLOGY', value: '25.4 TB' },
        { label: 'GENOMICS', value: '4.2 PB' }
    ];

    if (!tickerInterval) {
        tickerInterval = window.setInterval(() => {
            tickerIndex = (tickerIndex + 1) % revolvingStats.length;
            const stat: RevolvingStat = revolvingStats[tickerIndex];
            if (label3) label3.textContent = stat.label;
            if (costEl) costEl.textContent = stat.value;
        }, 2000);
    }
}

/**
 * Renders the metrics dashboard for the Gather stage (Selected Stats).
 */
export function gatherMetrics_render(selectedDatasets: Dataset[], costEstimate: CostEstimate): void {
    ticker_stop();

    const datasetsEl: HTMLElement | null = document.getElementById('cascade-datasets');
    const imagesEl: HTMLElement | null = document.getElementById('cascade-images');
    const costEl: HTMLElement | null = document.getElementById('cascade-cost');
    const statusEl: HTMLElement | null = document.getElementById('cascade-status');

    const label1: HTMLElement | null = document.getElementById('cascade-label-1');
    const label2: HTMLElement | null = document.getElementById('cascade-label-2');
    const label3: HTMLElement | null = document.getElementById('cascade-label-3');
    const label4: HTMLElement | null = document.getElementById('cascade-label-4');

    if (label1) label1.textContent = 'SELECTED';
    if (label2) label2.textContent = 'PROVIDERS';
    if (label3) label3.textContent = 'EST. COST';
    if (label4) label4.textContent = 'SIZE';

    const uniqueProviders: number = new Set(selectedDatasets.map((ds: Dataset) => ds.provider)).size;
    const totalSize: string = selectedDatasets.length > 0 ? "2.4 GB" : "0 B"; // Mock calculation

    if (datasetsEl) datasetsEl.textContent = selectedDatasets.length.toString();
    if (imagesEl) imagesEl.textContent = uniqueProviders.toString();
    if (costEl) costEl.textContent = `$${costEstimate.total.toFixed(0)}`;
    if (statusEl) statusEl.textContent = totalSize;
}

/**
 * Renders the metrics dashboard for the Post stage (Final Summary).
 */
export function postMetrics_render(): void {
    ticker_stop();
    
    const datasetsEl: HTMLElement | null = document.getElementById('cascade-datasets');
    const imagesEl: HTMLElement | null = document.getElementById('cascade-images');
    const costEl: HTMLElement | null = document.getElementById('cascade-cost');
    const statusEl: HTMLElement | null = document.getElementById('cascade-status');

    const label1: HTMLElement | null = document.getElementById('cascade-label-1');
    const label2: HTMLElement | null = document.getElementById('cascade-label-2');
    const label3: HTMLElement | null = document.getElementById('cascade-label-3');
    const label4: HTMLElement | null = document.getElementById('cascade-label-4');

    if (label1) label1.textContent = 'PUBLISHED';
    if (label2) label2.textContent = 'ACCURACY';
    if (label3) label3.textContent = 'FINAL COST';
    if (label4) label4.textContent = 'STATUS';

    if (datasetsEl) datasetsEl.textContent = "1";
    if (imagesEl) imagesEl.textContent = "94.2%";
    if (costEl) costEl.textContent = "$127";
    if (statusEl) statusEl.textContent = "LIVE";
}