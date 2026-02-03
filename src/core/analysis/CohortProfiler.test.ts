import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { cohort_analyze } from './CohortProfiler.js';

describe('CohortProfiler', () => {
    let vfs: VirtualFileSystem;

    beforeEach(() => {
        vfs = new VirtualFileSystem();
        vfs.dir_create('/home/user/projects/test/input');
    });

    it('should return error if input dir is missing', () => {
        const report = cohort_analyze(vfs, '/home/user/projects/missing/input');
        expect(report).toContain('ERROR: NO INPUT DATA FOUND');
    });

    it('should return error if input dir is empty', () => {
        const report = cohort_analyze(vfs, '/home/user/projects/test/input');
        expect(report).toContain('ERROR: COHORT IS EMPTY');
    });

    it('should detect mixed modalities', () => {
        // Setup Site A (Xray)
        vfs.dir_create('/home/user/projects/test/input/siteA');
        vfs.file_create('/home/user/projects/test/input/siteA/manifest.json', JSON.stringify({
            modality: 'xray'
        }));

        // Setup Site B (Pathology)
        vfs.dir_create('/home/user/projects/test/input/siteB');
        vfs.file_create('/home/user/projects/test/input/siteB/manifest.json', JSON.stringify({
            modality: 'pathology'
        }));

        const report = cohort_analyze(vfs, '/home/user/projects/test/input');
        expect(report).toContain('MISMATCH DETECTED');
        expect(report).toContain('WARNING: HIGH NON-IID DETECTED');
    });

    it('should confirm viable cohort for matched modalities', () => {
        // Setup Site A (Xray)
        vfs.dir_create('/home/user/projects/test/input/siteA');
        vfs.file_create('/home/user/projects/test/input/siteA/manifest.json', JSON.stringify({
            modality: 'xray'
        }));

        // Setup Site B (Xray)
        vfs.dir_create('/home/user/projects/test/input/siteB');
        vfs.file_create('/home/user/projects/test/input/siteB/manifest.json', JSON.stringify({
            modality: 'xray'
        }));

        const report = cohort_analyze(vfs, '/home/user/projects/test/input');
        expect(report).not.toContain('MISMATCH DETECTED');
        expect(report).toContain('COHORT STATISTICALLY VIABLE');
    });
});
