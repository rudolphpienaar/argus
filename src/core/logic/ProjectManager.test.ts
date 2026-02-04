/**
 * @file ProjectManager Unit Tests
 *
 * Verifies project creation, initialization, and gathering logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { project_createDraft, project_gather } from './ProjectManager.js';
import { store, globals } from '../state/store.js';
import { MOCK_PROJECTS } from '../data/projects.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { Shell } from '../../vfs/Shell.js';
import { DATASETS } from '../data/datasets.js';

describe('ProjectManager', () => {
    let originalProjectsLength: number;

    beforeEach(() => {
        // Setup fresh VFS/Shell for each test
        globals.vcs = new VirtualFileSystem();
        globals.shell = new Shell(globals.vcs, 'fedml');
        
        // Mock terminal to avoid console noise
        globals.terminal = {
            println: vi.fn(),
            prompt_sync: vi.fn(),
            // ... other methods irrelevant for this test
        } as any;

        // Reset store
        store.project_unload();
        
        originalProjectsLength = MOCK_PROJECTS.length;
    });

    afterEach(() => {
        // Cleanup MOCK_PROJECTS additions
        while (MOCK_PROJECTS.length > originalProjectsLength) {
            MOCK_PROJECTS.pop();
        }
    });

    describe('project_createDraft', () => {
        it('should create a new draft project and add it to mock repo', () => {
            const draft = project_createDraft();
            expect(draft.name).toMatch(/^DRAFT-\d+$/);
            expect(MOCK_PROJECTS).toContain(draft);
        });
    });

    describe('project_gather', () => {
        const dataset = DATASETS[0]; // BCH-PNEUMONIA

        it('should auto-create draft if no active project', () => {
            expect(store.state.activeProject).toBeNull();

            const project = project_gather(dataset);

            // 1. Should be a draft
            expect(project.name).toMatch(/^DRAFT-\d+$/);
            
            // 2. Should be active in store
            expect(store.state.activeProject).toBe(project);
            
            // 3. Dataset should be linked
            expect(project.datasets).toContain(dataset);
            
            // 4. Dataset should be selected in store
            expect(store.state.selectedDatasets).toContain(dataset);
            
            // 5. VFS should be mounted
            const username = globals.shell?.env_get('USER') || 'user';
            const dsDir = dataset.name.replace(/\s+/g, '_');
            const path = `/home/${username}/projects/${project.name}/input/${dsDir}/manifest.json`;
            expect(globals.vcs.node_stat(path)).not.toBeNull();
        });

        it('should use existing active project', () => {
            // Setup existing project
            const existing = project_createDraft();
            store.project_load(existing);
            
            const gathered = project_gather(dataset);
            
            expect(gathered).toBe(existing);
            expect(existing.datasets).toContain(dataset);
        });

        it('should sync shell context to new draft', () => {
            project_gather(dataset);
            
            const active = store.state.activeProject!;
            const username = globals.shell?.env_get('USER');
            const expectedCwd = `/home/${username}/projects/${active.name}`;
            
            expect(globals.vcs.cwd_get()).toBe(expectedCwd);
            expect(globals.shell?.env_get('PROJECT')).toBe(active.name);
        });
    });
});
