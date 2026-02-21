import { describe, it, expect } from 'vitest';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { Shell } from '../vfs/Shell.js';
import { SearchProvider } from './SearchProvider.js';

describe('SearchProvider semantic search', (): void => {
    function provider_create(): SearchProvider {
        const vfs: VirtualFileSystem = new VirtualFileSystem('fedml');
        const shell: Shell = new Shell(vfs, 'fedml');
        return new SearchProvider(vfs, shell);
    }

    it('keeps strict lexical search behavior for full-phrase misses', (): void => {
        const provider: SearchProvider = provider_create();
        const lexical = provider.search('histology data');
        expect(lexical).toHaveLength(0);
    });

    it('resolves natural-language phrase misses via semantic expansion', (): void => {
        const provider: SearchProvider = provider_create();
        const semantic = provider.search_semantic('histology data');
        expect(semantic.some(ds => ds.id === 'ds-006')).toBe(true);
        expect(semantic.some(ds => ds.id === 'ds-001')).toBe(false);
    });

    it('supports modality synonym expansion for xray phrasing', (): void => {
        const provider: SearchProvider = provider_create();
        const semantic = provider.search_semantic('xray datasets');
        expect(semantic.some(ds => ds.id === 'ds-001')).toBe(true);
    });
});
