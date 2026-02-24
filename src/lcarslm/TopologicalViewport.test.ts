import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { Shell } from '../vfs/Shell.js';
import { CalypsoCore } from './CalypsoCore.js';
import { storeAdapter } from './adapters/StoreAdapter.js';
import { store } from '../core/state/store.js';

describe('Topological Viewport: Search -> Gather Convergence', () => {
    let vfs: VirtualFileSystem;
    let shell: Shell;
    let core: CalypsoCore;

    beforeEach(async () => {
        vfs = new VirtualFileSystem('rudolph');
        shell = new Shell(vfs, 'rudolph');
        store.globalVcs_set(vfs);
        store.globalShell_set(shell);
        store.persona_set('fedml');
        
        core = new CalypsoCore(vfs, shell, storeAdapter, {
            workflowId: 'fedml'
        });
        await core.boot();
        await core.workflow_set('fedml');
    });

    it('should materialize data in gather/output and project it to scratch', async () => {
        // 1. Search
        await core.command_execute('search histology');
        
        // 2. Add
        await core.command_execute('add ds-006');

        // 3. Gather (to close the stage and anchor the viewport)
        await core.command_execute('gather');
        
        const state: any = core.store_snapshot();
        const sessionId = state.currentSessionId;
        const projectName = state.activeProject.name;
        
        const provenancePath = `/home/rudolph/projects/fedml/${sessionId}/provenance/search/gather/output`;
        const sessionRoot = `/home/rudolph/projects/fedml/${sessionId}`;
        const viewportPath = `${sessionRoot}/gather`;

        // VERIFY SHELL POSITION
        // v11.0: Shell should be INSIDE the alias (Logical PWD)
        expect(shell.env_get('PWD')).toBe(viewportPath);
        expect(vfs.cwd_get()).toBe(provenancePath);

        // VERIFY PHYSICAL DATA
        const outputEntries = vfs.dir_list(provenancePath);
        expect(outputEntries.some(e => e.name === 'Histology_Segmentation')).toBe(true);
        expect(outputEntries.some(e => e.name === 'training')).toBe(false);
        expect(outputEntries.some(e => e.name === 'validation')).toBe(false);

        // VERIFY VIEWPORT IN SESSION ROOT (ls @)
        const sessionRootEntries = vfs.dir_list(sessionRoot);
        const aliasLink = sessionRootEntries.find(e => e.name === 'gather');
        expect(aliasLink).toBeDefined();
        expect(aliasLink?.type).toBe('link');

        // VERIFY DIRECT CONTENT ACCESS
        // ls in CWD should show dataset cohort payload directly
        const currentEntries = vfs.dir_list('.');
        expect(currentEntries.some(e => e.name === 'Histology_Segmentation')).toBe(true);
        expect(currentEntries.some(e => e.name === 'training')).toBe(false);
        
        // CRITICAL STABILITY CHECK: No link-to-self recursion
        // The viewport MUST NOT contain another link with its own name
        expect(currentEntries.some(e => e.name === projectName)).toBe(false);
    });
});
