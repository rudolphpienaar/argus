/**
 * @file ProjectManager Unit Tests
 *
 * Verifies project creation, initialization, and gathering logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { project_gather } from './ProjectManager.js';
import { store } from '../state/store.js';
import { MOCK_PROJECTS } from '../data/projects.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { Shell } from '../../vfs/Shell.js';
import { DATASETS } from '../data/datasets.js';

describe('ProjectManager', () => {
    let originalProjectsLength: number;

    beforeEach(() => {
        // Setup fresh VFS/Shell for each test
        store.globalVcs_set(new VirtualFileSystem());
        store.globalShell_set(new Shell(store.globals.vcs, 'fedml'));
        
        // Mock terminal to avoid console noise
        store.globalTerminal_set({
            println: vi.fn(),
            prompt_sync: vi.fn(),
            // ... other methods irrelevant for this test
        } as any);

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

    describe('project_gather', () => {
        const dataset = DATASETS[0]; // BCH-PNEUMONIA

        it('should initialize project if no active project', () => {
            expect(store.state.activeProject).toBeNull();

            const project = project_gather(dataset);

            // 1. Should have no name (Bootstrap phase)
            expect(project.name).toBe('');
            
            // 2. Should be active in store
            expect(store.state.activeProject).toBe(project);
            
            // 3. Dataset should be linked
            expect(project.datasets).toContain(dataset);
            
            // 4. Dataset should be selected in store
            expect(store.state.selectedDatasets).toContain(dataset);
        });

        it('should use existing active project', () => {
            // Setup existing project
            const existing = {
                id: 'test-proj',
                name: 'Existing',
                datasets: [],
                created: new Date(),
                lastModified: new Date()
            };
            store.project_load(existing as any);
            
            const gathered = project_gather(dataset);
            
            expect(gathered).toBe(existing as any);
            expect(existing.datasets).toContain(dataset);
        });
    });
});
