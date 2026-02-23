/**
 * @file Plugin: ML Readiness
 *
 * Validates whether a gathered cohort is a meaningful ML experiment before
 * downstream harmonization and training stages.
 *
 * @module plugins/ml-readiness
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import type { FileNode } from '../vfs/types.js';
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';
import { simDelay_wait } from './simDelay.js';

type Objective = 'auto' | 'classification' | 'detection' | 'segmentation';
type TaskType = 'classification' | 'detection' | 'segmentation' | 'unknown';

interface CohortAssessment {
    dataset: string;
    task: TaskType;
    imageCount: number;
    supervisionCount: number;
    supervisionArtifact: string | null;
    ready: boolean;
    issues: string[];
}

interface ReadinessSummary {
    objective: Objective;
    requireSupervision: boolean;
    mixedTasks: boolean;
    taskCounts: Record<string, number>;
    datasets: CohortAssessment[];
    decision: 'pass' | 'fail';
    reason: string;
}

/**
 * Execute readiness validation.
 *
 * @param context - Standard plugin execution context.
 * @returns Plugin result with pass/fail status and readiness reports.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const { vfs, dataDir, ui, parameters } = context;

        ui.status('CALYPSO: EVALUATING ML READINESS');

        const inputDir: string = dataDir.replace(/\/output$/, '/input');
        const gatherPath: string = `${inputDir}/gather`;

        if (!vfs.node_stat(gatherPath)) {
            return {
                message: CalypsoPresenter.error_format('ML READINESS FAILED: GATHER INPUT NOT FOUND.'),
                statusCode: CalypsoStatusCode.BLOCKED_MISSING,
            };
        }

        const objective: Objective = objective_resolve(parameters.objective);
        const requireSupervision: boolean = parameters.require_supervision !== false;

        const datasetDirs: FileNode[] = vfs
            .dir_list(gatherPath)
            .filter((node: FileNode): boolean => node.type === 'folder' && !node.name.startsWith('.'))
            .sort((a: FileNode, b: FileNode): number => a.name.localeCompare(b.name));

        if (datasetDirs.length === 0) {
            return {
                message: CalypsoPresenter.error_format('ML READINESS FAILED: NO COHORT DATASETS FOUND.'),
                statusCode: CalypsoStatusCode.BLOCKED_MISSING,
            };
        }

        const assessments: CohortAssessment[] = [];
        for (let i = 0; i < datasetDirs.length; i++) {
            const ds: FileNode = datasetDirs[i];
            const percent: number = Math.round(((i + 1) / datasetDirs.length) * 100);
            ui.progress(`Assessing cohort ${i + 1}/${datasetDirs.length}: ${ds.name}`, percent);
            await simDelay_wait(90);
            assessments.push(cohort_assess(vfs, ds.path, ds.name, requireSupervision));
        }

        const summary: ReadinessSummary = summary_build(assessments, objective, requireSupervision);

        vfs.file_create(`${dataDir}/task-matrix.json`, JSON.stringify(assessments, null, 2));
        vfs.file_create(`${dataDir}/ml-readiness.json`, JSON.stringify(summary, null, 2));
        vfs.file_create(`${dataDir}/coverage-report.md`, report_markdownBuild(summary));

        if (summary.decision === 'pass') {
            return {
                message:
                    CalypsoPresenter.success_format('ML READINESS: PASS') +
                    `\n○ Objective: ${summary.objective}` +
                    `\n○ Cohorts evaluated: ${assessments.length}` +
                    `\n○ Task mix: ${Object.entries(summary.taskCounts)
                        .filter((entry: [string, number]): boolean => entry[1] > 0)
                        .map((entry: [string, number]): string => `${entry[0]}=${entry[1]}`)
                        .join(', ')}`,
                statusCode: CalypsoStatusCode.OK,
                artifactData: summary,
                materialized: ['ml-readiness.json', 'task-matrix.json', 'coverage-report.md'],
            };
        }

        const blockedCode: CalypsoStatusCode = summary.reason.includes('supervision') || summary.reason.includes('unknown')
            ? CalypsoStatusCode.BLOCKED_MISSING
            : CalypsoStatusCode.BLOCKED;

        return {
            message:
                CalypsoPresenter.error_format('ML READINESS: FAIL') +
                `\n○ Reason: ${summary.reason}` +
                `\n○ Re-run with a coherent cohort or set objective explicitly.`,
            statusCode: blockedCode,
            artifactData: summary,
            materialized: ['ml-readiness.json', 'task-matrix.json', 'coverage-report.md'],
        };
    });
}

/**
 * Resolve objective parameter into supported value.
 *
 * @param raw - Untrusted objective input.
 * @returns Normalized objective value.
 */
function objective_resolve(raw: unknown): Objective {
    const normalized: string = String(raw || 'auto').trim().toLowerCase();
    if (normalized === 'classification' || normalized === 'detection' || normalized === 'segmentation') {
        return normalized;
    }
    return 'auto';
}

/**
 * Assess one gathered cohort directory.
 *
 * @param vfs - Virtual filesystem.
 * @param datasetPath - Absolute VFS path to the dataset directory.
 * @param datasetName - Display name.
 * @param requireSupervision - Whether missing labels/masks should fail readiness.
 * @returns Cohort assessment record.
 */
function cohort_assess(
    vfs: PluginContext['vfs'],
    datasetPath: string,
    datasetName: string,
    requireSupervision: boolean,
): CohortAssessment {
    const issues: string[] = [];
    const imageCount: number = images_count(vfs, `${datasetPath}/images`);

    const hasMasks: boolean = Boolean(vfs.node_stat(`${datasetPath}/masks`));
    const hasAnnotations: boolean = Boolean(vfs.node_stat(`${datasetPath}/annotations.json`));
    const hasLabels: boolean = Boolean(vfs.node_stat(`${datasetPath}/labels.csv`));

    let task: TaskType = 'unknown';
    let supervisionCount: number = 0;
    let supervisionArtifact: string | null = null;

    if (hasMasks) {
        task = 'segmentation';
        supervisionArtifact = 'masks';
        supervisionCount = files_count(vfs, `${datasetPath}/masks`);
    } else if (hasAnnotations) {
        task = 'detection';
        supervisionArtifact = 'annotations.json';
        supervisionCount = annotations_count(vfs, `${datasetPath}/annotations.json`);
    } else if (hasLabels) {
        task = 'classification';
        supervisionArtifact = 'labels.csv';
        supervisionCount = labels_count(vfs, `${datasetPath}/labels.csv`);
    }

    if (task === 'unknown') {
        issues.push('unknown supervision shape');
    }

    if (imageCount === 0) {
        issues.push('no image payloads found');
    }

    if (requireSupervision && supervisionCount === 0) {
        issues.push('supervision artifact present but empty');
    }

    return {
        dataset: datasetName,
        task,
        imageCount,
        supervisionCount,
        supervisionArtifact,
        ready: issues.length === 0,
        issues,
    };
}

/**
 * Build readiness summary from per-cohort assessments.
 *
 * @param assessments - Cohort assessments.
 * @param objective - Requested objective.
 * @param requireSupervision - Whether supervision is mandatory.
 * @returns Summary object including pass/fail decision.
 */
function summary_build(
    assessments: CohortAssessment[],
    objective: Objective,
    requireSupervision: boolean,
): ReadinessSummary {
    const taskCounts: Record<string, number> = {
        classification: 0,
        detection: 0,
        segmentation: 0,
        unknown: 0,
    };

    for (const item of assessments) {
        taskCounts[item.task] = (taskCounts[item.task] || 0) + 1;
    }

    const knownTaskTypes: string[] = ['classification', 'detection', 'segmentation'].filter(
        (task: string): boolean => (taskCounts[task] || 0) > 0,
    );
    const mixedTasks: boolean = knownTaskTypes.length > 1;

    let decision: 'pass' | 'fail' = 'pass';
    let reason: string = 'cohort is consistent with objective';

    if (taskCounts.unknown > 0) {
        decision = 'fail';
        reason = 'unknown supervision shape present in gathered cohorts';
    } else if (requireSupervision && assessments.some((item: CohortAssessment): boolean => item.supervisionCount === 0)) {
        decision = 'fail';
        reason = 'supervision coverage incomplete for one or more cohorts';
    } else if (objective !== 'auto' && assessments.some((item: CohortAssessment): boolean => item.task !== objective)) {
        decision = 'fail';
        reason = `objective mismatch: expected '${objective}' but mixed tasks were detected`;
    } else if (objective === 'auto' && mixedTasks) {
        decision = 'fail';
        reason = 'mixed task cohort detected under objective=auto';
    }

    return {
        objective,
        requireSupervision,
        mixedTasks,
        taskCounts,
        datasets: assessments,
        decision,
        reason,
    };
}

/**
 * Count image payload files in a dataset image directory.
 *
 * @param vfs - Virtual filesystem.
 * @param imageDir - Absolute image directory path.
 * @returns Number of image files.
 */
function images_count(vfs: PluginContext['vfs'], imageDir: string): number {
    return files_count(vfs, imageDir, /\.(jpg|jpeg|png|bmp|gif)$/i);
}

/**
 * Count files in a directory optionally constrained by a filename pattern.
 *
 * @param vfs - Virtual filesystem.
 * @param dir - Absolute directory path.
 * @param pattern - Optional filename pattern.
 * @returns Number of files.
 */
function files_count(vfs: PluginContext['vfs'], dir: string, pattern?: RegExp): number {
    try {
        return vfs
            .dir_list(dir)
            .filter((entry: FileNode): boolean => entry.type === 'file')
            .filter((entry: FileNode): boolean => (pattern ? pattern.test(entry.name) : true)).length;
    } catch {
        return 0;
    }
}

/**
 * Count label rows in a labels CSV payload.
 *
 * @param vfs - Virtual filesystem.
 * @param path - labels.csv path.
 * @returns Number of label rows excluding comments/header.
 */
function labels_count(vfs: PluginContext['vfs'], path: string): number {
    try {
        const raw: string | null = vfs.node_read(path);
        if (!raw) return 0;
        return raw
            .split('\n')
            .map((line: string): string => line.trim())
            .filter((line: string): boolean => line.length > 0)
            .filter((line: string): boolean => !line.startsWith('#'))
            .filter((line: string): boolean => !line.toLowerCase().startsWith('filename,')).length;
    } catch {
        return 0;
    }
}

/**
 * Count annotation items from detection annotation payload.
 *
 * @param vfs - Virtual filesystem.
 * @param path - annotations.json path.
 * @returns Number of annotation entries.
 */
function annotations_count(vfs: PluginContext['vfs'], path: string): number {
    try {
        const raw: string | null = vfs.node_read(path);
        if (!raw) return 0;
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.length;
        }
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { annotations?: unknown[] }).annotations)) {
            return ((parsed as { annotations?: unknown[] }).annotations || []).length;
        }
        return 0;
    } catch {
        return 0;
    }
}

/**
 * Render markdown coverage report.
 *
 * @param summary - Readiness summary.
 * @returns Markdown report text.
 */
function report_markdownBuild(summary: ReadinessSummary): string {
    const lines: string[] = [];
    lines.push('# ML Readiness Coverage Report');
    lines.push('');
    lines.push(`- Decision: **${summary.decision.toUpperCase()}**`);
    lines.push(`- Objective: \\`${summary.objective}\\``);
    lines.push(`- Mixed tasks: **${summary.mixedTasks ? 'YES' : 'NO'}**`);
    lines.push(`- Reason: ${summary.reason}`);
    lines.push('');
    lines.push('| Dataset | Task | Images | Supervision | Ready | Issues |');
    lines.push('|---|---:|---:|---:|---:|---|');

    for (const ds of summary.datasets) {
        lines.push(
            `| ${ds.dataset} | ${ds.task} | ${ds.imageCount} | ${ds.supervisionCount} | ${ds.ready ? 'YES' : 'NO'} | ${ds.issues.join('; ') || 'none'} |`,
        );
    }

    lines.push('');
    lines.push('## Task Counts');
    lines.push('');
    lines.push(`- classification: ${summary.taskCounts.classification || 0}`);
    lines.push(`- detection: ${summary.taskCounts.detection || 0}`);
    lines.push(`- segmentation: ${summary.taskCounts.segmentation || 0}`);
    lines.push(`- unknown: ${summary.taskCounts.unknown || 0}`);
    lines.push('');

    return lines.join('\n') + '\n';
}
