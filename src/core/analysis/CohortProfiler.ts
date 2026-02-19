/**
 * @file Cohort Profiler
 *
 * Performs statistical analysis on gathered datasets to detect heterogeneity
 * and non-IID risks before federated training.
 *
 * @module
 */

import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { FileNode } from '../../vfs/types.js';

interface CohortStats {
    totalSites: number;
    modalities: Record<string, number>;
    providers: Record<string, number>;
    sites: SiteProfile[];
}

interface SiteProfile {
    name: string;
    modality: string;
    imageCount: number;
    labelDistribution: { label: string; count: number }[]; // Mocked for now
}

interface CohortValidation {
    stats: CohortStats;
    isMixedModality: boolean;
    hasSkewedLabels: boolean;
    error?: string;
}

/**
 * Validates the cohort logic. Returns structured data for programmatic checking.
 *
 * @param vfs - The Virtual File System instance.
 * @param projectInputPath - Path to the project's input directory.
 * @returns Structured validation result.
 */
export function cohort_validate(vfs: VirtualFileSystem, projectInputPath: string): CohortValidation {
    try {
        if (!vfs.node_stat(projectInputPath)) {
            return { stats: emptyStats_create(), isMixedModality: false, hasSkewedLabels: false, error: 'NO INPUT DATA FOUND. GATHER DATASETS FIRST.' };
        }

        const sites: FileNode[] = vfs.dir_list(projectInputPath).filter((node: FileNode) => node.type === 'folder');
        if (sites.length === 0) {
            return { stats: emptyStats_create(), isMixedModality: false, hasSkewedLabels: false, error: 'COHORT IS EMPTY.' };
        }

        const stats: CohortStats = {
            totalSites: sites.length,
            modalities: {},
            providers: {},
            sites: []
        };

        let hasSkewedLabels = false;

        // Scan each site
        for (const site of sites) {
            const manifestPath = `${site.path}/manifest.json`;
            let modality = 'unknown';
            let imageCount = 0;

            try {
                const content: string | null = vfs.node_read(manifestPath);
                if (content) {
                    const meta = JSON.parse(content);
                    modality = meta.modality || 'unknown';
                }
            } catch (e: unknown) { /* ignore read errors */ }

            try {
                const images: FileNode[] = vfs.dir_list(`${site.path}/images`);
                imageCount = images.length;
            } catch { /* ignore dir errors */ }

            stats.modalities[modality] = (stats.modalities[modality] || 0) + 1;
            stats.providers[site.name] = (stats.providers[site.name] || 0) + 1;

            const dist = mockLabel_generate(modality);
            if (dist.length === 2) {
                const p1 = dist[0].count;
                const total = p1 + dist[1].count;
                const ratio = p1 / total;
                if (ratio > 0.8 || ratio < 0.2) hasSkewedLabels = true;
            }

            stats.sites.push({
                name: site.name,
                modality,
                imageCount,
                labelDistribution: dist
            });
        }

        const uniqueModalities = Object.keys(stats.modalities);
        const isMixedModality = uniqueModalities.length > 1;

        return { stats, isMixedModality, hasSkewedLabels: false };

    } catch (e: unknown) {
        return { 
            stats: emptyStats_create(), 
            isMixedModality: false, 
            hasSkewedLabels: false, 
            error: e instanceof Error ? e.message : String(e) 
        };
    }
}

function emptyStats_create(): CohortStats {
    return { totalSites: 0, modalities: {}, providers: {}, sites: [] };
}

/**
 * Analyzes the gathered cohort in the current project and returns an ASCII report.
 *
 * @param vfs - The Virtual File System instance.
 * @param projectInputPath - Path to the project's input directory (e.g., ~/projects/X/input).
 * @returns Formatted ASCII report string.
 */
export function cohort_analyze(vfs: VirtualFileSystem, projectInputPath: string): string {
    const report: string[] = [];
    report.push('ARGUS: ANALYZING COHORT HETEROGENEITY...');
    report.push('');

    const validation = cohort_validate(vfs, projectInputPath);

    if (validation.error) {
        return `<span class="error">>> ERROR: ${validation.error}</span>`;
    }

    const { stats, isMixedModality } = validation;

    // 1. Modality Check
    report.push('[MODALITY CHECK]');
    const uniqueModalities = Object.keys(stats.modalities);
    stats.sites.forEach((site: SiteProfile) => {
        const isOutlier: boolean = uniqueModalities.length > 1 && stats.modalities[site.modality] < stats.totalSites;
        const status: string = isOutlier ? `[${site.modality.toUpperCase()}] << MISMATCH DETECTED` : `[${site.modality.toUpperCase()}]`;
        const color: string = isOutlier ? 'error' : 'success';
        report.push(`  ${site.name.padEnd(20)} <span class="${color}">${status}</span>`);
    });
    report.push('');

    // 2. Distribution Shift (Visual)
    report.push('[DISTRIBUTION SHIFT]');
    stats.sites.forEach((site: SiteProfile) => {
        const dist = site.labelDistribution;
        if (dist.length === 2) {
            const p1: number = dist[0].count;
            const total: number = p1 + dist[1].count;
            const ratio: number = p1 / total;
            const barLength = 20;
            const filled: number = Math.round(ratio * barLength);
            const bar: string = '#'.repeat(filled) + '-'.repeat(barLength - filled);
            const percent: number = Math.round(ratio * 100);
            
            const isSkewed: boolean = ratio > 0.8 || ratio < 0.2;
            const color: string = isSkewed ? 'warn' : 'highlight';
            
            report.push(`  ${site.name.padEnd(8)} <span class="${color}">[${bar}]</span> (${percent}% ${dist[0].label})`);
        } else {
            report.push(`  ${site.name.padEnd(8)} [NO LABELS DETECTED]`);
        }
    });
    report.push('');

    // Summary
    if (isMixedModality) {
        report.push('<span class="error">>> WARNING: HIGH NON-IID DETECTED. FEDERATION UNSTABLE.</span>');
        report.push('<span class="dim">   Resolution: Remove incompatible sites or add preprocessing.</span>');
    } else {
        report.push('<span class="success">>> COHORT STATISTICALLY VIABLE. READY FOR FEDERATION.</span>');
    }

    return report.join('\n');
}

function mockLabel_generate(modality: string): { label: string; count: number }[] {
    // Generate semi-random distributions to show heterogeneity
    const total: number = 100 + Math.floor(Math.random() * 100);
    const split: number = 0.3 + Math.random() * 0.6; // 30% to 90%
    const countA: number = Math.floor(total * split);
    const countB: number = total - countA;
    
    if (modality === 'xray') return [{ label: 'Pneumonia', count: countA }, { label: 'Normal', count: countB }];
    if (modality === 'mri') return [{ label: 'Tumor', count: countA }, { label: 'Benign', count: countB }];
    return [{ label: 'Positive', count: countA }, { label: 'Negative', count: countB }];
}
