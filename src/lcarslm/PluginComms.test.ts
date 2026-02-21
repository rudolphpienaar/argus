import { describe, expect, it } from 'vitest';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { Shell } from '../vfs/Shell.js';
import { SearchProvider } from './SearchProvider.js';
import { PluginCommsRuntime } from './PluginComms.js';

describe('PluginCommsRuntime', (): void => {
    function comms_create(): PluginCommsRuntime {
        const vfs: VirtualFileSystem = new VirtualFileSystem('fedml');
        const shell: Shell = new Shell(vfs, 'fedml');
        const search: SearchProvider = new SearchProvider(vfs, shell);
        return new PluginCommsRuntime(search);
    }

    it('prefers primary path when predicate passes', async (): Promise<void> => {
        const comms: PluginCommsRuntime = comms_create();
        const result = await comms.resolve<number>({
            primary: (): number => 3,
            fallback: (): number => 7,
            preferPrimary: (value: number): boolean => value > 0,
        });

        expect(result.path).toBe('primary');
        expect(result.value).toBe(3);
        expect(result.primaryValue).toBe(3);
    });

    it('falls back to semantic dataset search on lexical miss', async (): Promise<void> => {
        const comms: PluginCommsRuntime = comms_create();
        const result = await comms.datasetSearch_resolve('histology data sets');

        expect(result.mode).toBe('semantic');
        expect(result.results.some(ds => ds.id === 'ds-006')).toBe(true);
    });

    it('resolves gather targets through primary/fallback service', async (): Promise<void> => {
        const comms: PluginCommsRuntime = comms_create();
        const result = await comms.datasetTargets_resolve(['ds-006', 'histology data']);

        expect(result.datasets.some(ds => ds.id === 'ds-006')).toBe(true);
        expect(result.usedSemanticFallback).toBe(true);
        expect(result.unresolved).toEqual([]);
    });
});
