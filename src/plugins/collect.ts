/**
 * @file Plugin: Collect
 *
 * Reorganizes gathered cohorts into a normalized collection layout without
 * mutating gather evidence. The collection view is task-grouped and split into
 * deterministic train/validation/test sets for downstream harmonization.
 *
 * @module plugins/collect
 */

import type { PluginContext, PluginResult } from '../lcarslm/types.js';
import { CalypsoStatusCode } from '../lcarslm/types.js';
import type { FileNode } from '../vfs/types.js';
import { CalypsoPresenter } from '../lcarslm/CalypsoPresenter.js';
import { simDelay_wait } from './simDelay.js';

type TaskType = 'classification' | 'detection' | 'segmentation' | 'unknown';
type SplitName = 'train' | 'validation' | 'test';

interface CohortRecord {
    dataset: string;
    task: TaskType;
    imageCount: number;
    supervisionArtifact: string | null;
    supervisionCount: number;
    split: SplitName;
}

interface RatioConfig {
    train: number;
    validation: number;
    test: number;
}

/**
 * Execute collection build.
 *
 * @param context - Standard plugin execution context.
 * @returns Plugin result with collection manifest details.
 */
export async function plugin_execute(context: PluginContext): Promise<PluginResult> {
    return context.comms.execute(async (): Promise<PluginResult> => {
        const { vfs, dataDir, ui, parameters } = context;

        ui.status('CALYPSO: BUILDING NORMALIZED COLLECTION');

        const inputDir: string = dataDir.replace(/\/output$/, '/input');
        const gatherPath: string = `${inputDir}/gather`;
        if (!vfs.node_stat(gatherPath)) {
            return {
                message: CalypsoPresenter.error_format('COLLECT FAILED: GATHER INPUT NOT FOUND.'),
                statusCode: CalypsoStatusCode.BLOCKED_MISSING,
            };
        }

        const datasetDirs: FileNode[] = vfs
            .dir_list(gatherPath)
            .filter((node: FileNode): boolean => node.type === 'folder' && !node.name.startsWith('.'))
            .sort((a: FileNode, b: FileNode): number => a.name.localeCompare(b.name));

        if (datasetDirs.length === 0) {
            return {
                message: CalypsoPresenter.error_format('COLLECT FAILED: NO COHORT DATASETS FOUND.'),
                statusCode: CalypsoStatusCode.BLOCKED_MISSING,
            };
        }

        const ratios: RatioConfig = ratios_resolve(parameters.train_ratio, parameters.validation_ratio);
        const seed: number = number_resolve(parameters.split_seed, 42);

        tree_prepare(vfs, dataDir);

        const records: CohortRecord[] = [];
        for (let i = 0; i < datasetDirs.length; i++) {
            const dataset = datasetDirs[i];
            const percent: number = Math.round(((i + 1) / datasetDirs.length) * 100);
            ui.progress(`Collecting cohort ${i + 1}/${datasetDirs.length}: ${dataset.name}`, percent);
            await simDelay_wait(80);

            const assessment = dataset_assess(vfs, dataset.path, dataset.name);
            const split: SplitName = split_assign(dataset.name, seed, ratios);
            const record: CohortRecord = {
                ...assessment,
                split,
            };
            records.push(record);

            // Keep links relative for portable provenance trees.
            const cohortTarget = `../../../input/gather/${dataset.name}`;
            vfs.link_create(`${dataDir}/cohorts/${record.task}/${dataset.name}`, cohortTarget);

            const splitTarget = `../../cohorts/${record.task}/${dataset.name}`;
            vfs.link_create(`${dataDir}/splits/${record.split}/${dataset.name}`, splitTarget);
        }

        const taskCounts = counts_byTask(records);
        const splitCounts = counts_bySplit(records);
        const summary = {
            generatedAt: new Date().toISOString(),
            source: 'gather',
            splitSeed: seed,
            ratios,
            counts: {
                datasets: records.length,
                task: taskCounts,
                split: splitCounts,
            },
            cohorts: records,
        };

        vfs.file_create(`${dataDir}/collection-manifest.json`, JSON.stringify(summary, null, 2));
        vfs.file_create(
            `${dataDir}/collect.json`,
            JSON.stringify(
                {
                    ok: true,
                    source: 'gather',
                    datasetCount: records.length,
                    taskCounts,
                    splitCounts,
                },
                null,
                2,
            ),
        );
        splitManifests_write(vfs, dataDir, records);

        return {
            message:
                CalypsoPresenter.success_format(`COLLECTION BUILD COMPLETE: ${records.length} COHORTS`) +
                `\n○ Task groups: class=${taskCounts.classification}, detect=${taskCounts.detection}, seg=${taskCounts.segmentation}, unknown=${taskCounts.unknown}` +
                `\n○ Splits: train=${splitCounts.train}, validation=${splitCounts.validation}, test=${splitCounts.test}`,
            statusCode: CalypsoStatusCode.OK,
            artifactData: summary,
            materialized: [
                'collect.json',
                'collection-manifest.json',
                'splits/train/manifest.json',
                'splits/validation/manifest.json',
                'splits/test/manifest.json',
            ],
        };
    });
}

/**
 * Ensure collection output directories exist.
 */
function tree_prepare(vfs: PluginContext['vfs'], dataDir: string): void {
    vfs.dir_create(`${dataDir}/cohorts/classification`);
    vfs.dir_create(`${dataDir}/cohorts/detection`);
    vfs.dir_create(`${dataDir}/cohorts/segmentation`);
    vfs.dir_create(`${dataDir}/cohorts/unknown`);
    vfs.dir_create(`${dataDir}/splits/train`);
    vfs.dir_create(`${dataDir}/splits/validation`);
    vfs.dir_create(`${dataDir}/splits/test`);
}

/**
 * Build a per-dataset task/supervision assessment.
 */
function dataset_assess(
    vfs: PluginContext['vfs'],
    datasetPath: string,
    datasetName: string,
): Omit<CohortRecord, 'split'> {
    const imageCount = files_count(vfs, `${datasetPath}/images`, /\.(jpg|jpeg|png|bmp|gif)$/i);
    const hasMasks = Boolean(vfs.node_stat(`${datasetPath}/masks`));
    const hasAnnotations = Boolean(vfs.node_stat(`${datasetPath}/annotations.json`));
    const hasLabels = Boolean(vfs.node_stat(`${datasetPath}/labels.csv`));

    if (hasMasks) {
        return {
            dataset: datasetName,
            task: 'segmentation',
            imageCount,
            supervisionArtifact: 'masks',
            supervisionCount: files_count(vfs, `${datasetPath}/masks`),
        };
    }

    if (hasAnnotations) {
        return {
            dataset: datasetName,
            task: 'detection',
            imageCount,
            supervisionArtifact: 'annotations.json',
            supervisionCount: annotations_count(vfs, `${datasetPath}/annotations.json`),
        };
    }

    if (hasLabels) {
        return {
            dataset: datasetName,
            task: 'classification',
            imageCount,
            supervisionArtifact: 'labels.csv',
            supervisionCount: labels_count(vfs, `${datasetPath}/labels.csv`),
        };
    }

    return {
        dataset: datasetName,
        task: 'unknown',
        imageCount,
        supervisionArtifact: null,
        supervisionCount: 0,
    };
}

/**
 * Count files in a directory optionally constrained by pattern.
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
 * Count label rows in labels CSV payload.
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
 * Count detection annotations from JSON payload.
 */
function annotations_count(vfs: PluginContext['vfs'], path: string): number {
    try {
        const raw: string | null = vfs.node_read(path);
        if (!raw) return 0;
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.length;
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { annotations?: unknown[] }).annotations)) {
            return ((parsed as { annotations?: unknown[] }).annotations || []).length;
        }
        return 0;
    } catch {
        return 0;
    }
}

/**
 * Resolve numeric parameter with fallback.
 */
function number_resolve(raw: unknown, fallback: number): number {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve split ratios and guarantee normalized proportions.
 */
function ratios_resolve(trainRaw: unknown, validationRaw: unknown): RatioConfig {
    const train = clamp01(number_resolve(trainRaw, 0.8));
    const validation = clamp01(number_resolve(validationRaw, 0.2));
    const sum = train + validation;

    if (sum <= 0 || sum > 1) {
        return { train: 0.8, validation: 0.2, test: 0 };
    }

    return {
        train,
        validation,
        test: Number((1 - sum).toFixed(6)),
    };
}

/**
 * Clamp value to [0, 1].
 */
function clamp01(value: number): number {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

/**
 * Deterministically assign dataset to a split using seeded hashing.
 */
function split_assign(datasetName: string, seed: number, ratios: RatioConfig): SplitName {
    const roll = hash_roll(datasetName, seed);
    if (roll < ratios.train) return 'train';
    if (roll < ratios.train + ratios.validation) return 'validation';
    return 'test';
}

/**
 * Compute deterministic [0, 1) roll from string + seed.
 */
function hash_roll(input: string, seed: number): number {
    let hash = seed >>> 0;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
}

/**
 * Count cohorts by task.
 */
function counts_byTask(records: CohortRecord[]): Record<TaskType, number> {
    return records.reduce(
        (acc: Record<TaskType, number>, record: CohortRecord): Record<TaskType, number> => {
            acc[record.task] += 1;
            return acc;
        },
        { classification: 0, detection: 0, segmentation: 0, unknown: 0 },
    );
}

/**
 * Count cohorts by split.
 */
function counts_bySplit(records: CohortRecord[]): Record<SplitName, number> {
    return records.reduce(
        (acc: Record<SplitName, number>, record: CohortRecord): Record<SplitName, number> => {
            acc[record.split] += 1;
            return acc;
        },
        { train: 0, validation: 0, test: 0 },
    );
}

/**
 * Write per-split manifest files.
 */
function splitManifests_write(vfs: PluginContext['vfs'], dataDir: string, records: CohortRecord[]): void {
    const bySplit: Record<SplitName, CohortRecord[]> = {
        train: [],
        validation: [],
        test: [],
    };
    for (const record of records) {
        bySplit[record.split].push(record);
    }

    (Object.keys(bySplit) as SplitName[]).forEach((split: SplitName): void => {
        vfs.file_create(`${dataDir}/splits/${split}/manifest.json`, JSON.stringify(bySplit[split], null, 2));
    });
}
