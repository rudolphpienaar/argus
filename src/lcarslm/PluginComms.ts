/**
 * @file PluginComms Runtime
 *
 * Host-owned primary/fallback resolver service injected into PluginContext.
 *
 * @module lcarslm/PluginComms
 */

import type { Dataset } from '../core/models/types.js';
import type { SearchProvider } from './SearchProvider.js';
import type {
    CommsPlan,
    CommsResolution,
    DatasetSearchResolution,
    DatasetTargetResolution,
    PluginComms,
} from './types.js';

interface SettledValue<T> {
    ok: true;
    value: T;
}

interface SettledError {
    ok: false;
    error: unknown;
}

type Settled<T> = SettledValue<T> | SettledError;

function settled_resolve<T>(task: () => Promise<T> | T): Promise<Settled<T>> {
    return Promise
        .resolve()
        .then(task)
        .then(
            (value: T): SettledValue<T> => ({ ok: true, value }),
            (error: unknown): SettledError => ({ ok: false, error })
        );
}

function error_throw(error: unknown): never {
    if (error instanceof Error) {
        throw error;
    }
    throw new Error(String(error));
}

function datasets_dedupe(datasets: Dataset[]): Dataset[] {
    const seen: Set<string> = new Set<string>();
    const out: Dataset[] = [];
    for (const dataset of datasets) {
        if (seen.has(dataset.id)) {
            continue;
        }
        seen.add(dataset.id);
        out.push(dataset);
    }
    return out;
}

export class PluginCommsRuntime implements PluginComms {
    constructor(private readonly searchProvider: SearchProvider) {}

    public async resolve<T>(plan: CommsPlan<T>): Promise<CommsResolution<T>> {
        const fallbackSettledPromise: Promise<Settled<T>> | null = plan.fallback
            ? settled_resolve(plan.fallback)
            : null;

        const primarySettled: Settled<T> = await settled_resolve(plan.primary);
        if (!primarySettled.ok) {
            if (fallbackSettledPromise) {
                const fallbackSettled: Settled<T> = await fallbackSettledPromise;
                if (fallbackSettled.ok) {
                    return {
                        value: fallbackSettled.value,
                        path: 'fallback',
                    };
                }
            }
            error_throw(primarySettled.error);
        }

        const primaryValue: T = primarySettled.value;
        const preferPrimary = plan.preferPrimary ?? (() => true);
        if (preferPrimary(primaryValue) || !fallbackSettledPromise) {
            return {
                value: primaryValue,
                path: 'primary',
                primaryValue,
            };
        }

        const fallbackSettled: Settled<T> = await fallbackSettledPromise;
        if (!fallbackSettled.ok) {
            error_throw(fallbackSettled.error);
        }

        return {
            value: fallbackSettled.value,
            path: 'fallback',
            primaryValue,
        };
    }

    public async execute<T>(primary: () => Promise<T> | T): Promise<T> {
        const resolved: CommsResolution<T> = await this.resolve({ primary });
        return resolved.value;
    }

    public async datasetSearch_resolve(query: string): Promise<DatasetSearchResolution> {
        const resolved: CommsResolution<Dataset[]> = await this.resolve<Dataset[]>({
            primary: (): Dataset[] => this.searchProvider.search(query),
            fallback: (): Dataset[] => this.searchProvider.search_semantic(query),
            preferPrimary: (datasets: Dataset[]): boolean => datasets.length > 0,
        });

        return {
            results: resolved.value,
            mode: resolved.path === 'primary' ? 'lexical' : 'semantic',
        };
    }

    public async datasetTargets_resolve(targets: string[]): Promise<DatasetTargetResolution> {
        const datasets: Dataset[] = [];
        const unresolved: string[] = [];
        let usedSemanticFallback = false;

        for (const target of targets) {
            const token: string = target.trim();
            if (!token) {
                continue;
            }

            const resolved: CommsResolution<Dataset[]> = await this.resolve<Dataset[]>({
                primary: (): Dataset[] => this.searchProvider.resolve(token),
                fallback: (): Dataset[] => this.searchProvider.search_semantic(token),
                preferPrimary: (items: Dataset[]): boolean => items.length > 0,
            });

            if (resolved.path === 'fallback') {
                usedSemanticFallback = true;
            }

            if (resolved.value.length === 0) {
                unresolved.push(token);
                continue;
            }

            datasets.push(...resolved.value);
        }

        return {
            datasets: datasets_dedupe(datasets),
            unresolved,
            usedSemanticFallback,
        };
    }
}
