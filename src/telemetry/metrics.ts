/**
 * @file Metrics Dashboard Generator
 * Handles the display of aggregated stats (Datasets, Images, Cost) for Search/Gather stages.
 */

import type { Dataset, CostEstimate, AppState } from '../core/models/types.js';

let tickerInterval: number | null = null;
let tickerIndex = 0;

/**
 * Stops any active ticker animation.
 */
export function stopTicker(): void {
    if (tickerInterval) {
        clearInterval(tickerInterval);
        tickerInterval = null;
    }
}

/**
 * Renders the metrics dashboard for the Search stage (Global Stats + Revolving Ticker).
 */
export function renderSearchMetrics(): void {
    const datasetsEl = document.getElementById('cascade-datasets');
    const imagesEl = document.getElementById('cascade-images');
    const costEl = document.getElementById('cascade-cost');
    const statusEl = document.getElementById('cascade-status');

    const label1 = document.getElementById('cascade-label-1');
    const label2 = document.getElementById('cascade-label-2');
    const label3 = document.getElementById('cascade-label-3');
    const label4 = document.getElementById('cascade-label-4');

    if (label1) label1.textContent = 'TOTAL DATASETS';
    if (label2) label2.textContent = 'TOTAL IMAGES';
    if (label3) label3.textContent = 'MODALITY';
    if (label4) label4.textContent = 'FEDERATION';

    if (datasetsEl) datasetsEl.textContent = '14,203';
    if (imagesEl) imagesEl.textContent = '45.2M';
    if (statusEl) statusEl.textContent = 'ONLINE';

    // Start Revolving Stats Ticker
    const revolvingStats = [
        { label: 'MODALITY', value: 'MRI: 12K' },
        { label: 'MODALITY', value: 'CT: 8.5K' },
        { label: 'MODALITY', value: 'X-RAY: 15K' },
        { label: 'PATHOLOGY', value: '25.4 TB' },
        { label: 'GENOMICS', value: '4.2 PB' }
    ];

    if (!tickerInterval) {
        tickerInterval = window.setInterval(() => {
            tickerIndex = (tickerIndex + 1) % revolvingStats.length;
            const stat = revolvingStats[tickerIndex];
            if (label3) label3.textContent = stat.label;
            if (costEl) costEl.textContent = stat.value;
        }, 2000);
    }
}

/**
 * Renders the metrics dashboard for the Gather stage (Selected Stats).
 */
export function renderGatherMetrics(selectedDatasets: Dataset[], costEstimate: CostEstimate): void {
    stopTicker();

    const datasetsEl = document.getElementById('cascade-datasets');
    const imagesEl = document.getElementById('cascade-images');
    const costEl = document.getElementById('cascade-cost');
    const statusEl = document.getElementById('cascade-status');

    const label1 = document.getElementById('cascade-label-1');
    const label2 = document.getElementById('cascade-label-2');
    const label3 = document.getElementById('cascade-label-3');
    const label4 = document.getElementById('cascade-label-4');

    if (label1) label1.textContent = 'SELECTED';
    if (label2) label2.textContent = 'PROVIDERS';
    if (label3) label3.textContent = 'EST. COST';
    if (label4) label4.textContent = 'SIZE';

    const uniqueProviders = new Set(selectedDatasets.map(ds => ds.provider)).size;
    const totalSize = selectedDatasets.length > 0 ? "2.4 GB" : "0 B"; // Mock calculation

    if (datasetsEl) datasetsEl.textContent = selectedDatasets.length.toString();
    if (imagesEl) imagesEl.textContent = uniqueProviders.toString();
    if (costEl) costEl.textContent = `$${costEstimate.total.toFixed(0)}`;
    if (statusEl) statusEl.textContent = totalSize;
}

/**
 * Renders the metrics dashboard for the Post stage (Final Summary).
 */
export function renderPostMetrics(): void {
    stopTicker();
    
    const datasetsEl = document.getElementById('cascade-datasets');
    const imagesEl = document.getElementById('cascade-images');
    const costEl = document.getElementById('cascade-cost');
    const statusEl = document.getElementById('cascade-status');

    const label1 = document.getElementById('cascade-label-1');
    const label2 = document.getElementById('cascade-label-2');
    const label3 = document.getElementById('cascade-label-3');
    const label4 = document.getElementById('cascade-label-4');

    if (label1) label1.textContent = 'PUBLISHED';
    if (label2) label2.textContent = 'ACCURACY';
    if (label3) label3.textContent = 'FINAL COST';
    if (label4) label4.textContent = 'STATUS';

    if (datasetsEl) datasetsEl.textContent = "1";
    if (imagesEl) imagesEl.textContent = "94.2%";
    if (costEl) costEl.textContent = "$127";
    if (statusEl) statusEl.textContent = "LIVE";
}
