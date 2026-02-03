import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { federation_simulate } from './PhantomFederation.js';

describe('PhantomFederation', () => {
    let vfs: VirtualFileSystem;

    beforeEach(() => {
        vfs = new VirtualFileSystem();
        vfs.dir_create('/home/user/projects/test/input');
        vfs.dir_create('/home/user/projects/test/src');
    });

    it('should fail if no input data', async () => {
        const vfsEmpty = new VirtualFileSystem();
        const result = await federation_simulate(vfsEmpty, '/home/user/projects/test');
        expect(result.success).toBe(false);
        expect(result.logs).toContain('ERROR: No input data found to shard.');
    });

    it('should fail if train.py missing', async () => {
        const result = await federation_simulate(vfs, '/home/user/projects/test');
        expect(result.success).toBe(false);
        expect(result.logs).toContain('ERROR: train.py not found.');
    });

    it('should succeed with valid setup', async () => {
        vfs.file_create('/home/user/projects/test/src/train.py');
        const result = await federation_simulate(vfs, '/home/user/projects/test');
        expect(result.success).toBe(true);
        expect(result.logs).toContain('>> AGGREGATION CONVERGED.');
    });
});
