/**
 * @file ContentRegistry Unit Tests
 *
 * Covers generator registration, content resolution, VFS integration,
 * and all template generators (train, readme, config, requirements,
 * manifest, catalog, nodeRegistry).
 *
 * @module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContentRegistry } from './ContentRegistry.js';
import { VirtualFileSystem } from '../VirtualFileSystem.js';
import { ALL_GENERATORS } from './templates/index.js';
import type { ContentGenerator, ContentContext } from '../types.js';

describe('ContentRegistry', () => {
    let registry: ContentRegistry;

    beforeEach(() => {
        registry = new ContentRegistry();
    });

    // ─── Registration ────────────────────────────────────────────

    describe('generator registration', () => {
        it('should register a single generator', () => {
            const gen: ContentGenerator = {
                pattern: 'test',
                generate: (_ctx: ContentContext): string => 'test content'
            };
            registry.generator_register('test', gen);
            expect(registry.generator_has('test')).toBe(true);
            expect(registry.generators_count()).toBe(1);
        });

        it('should register multiple generators at once', () => {
            registry.generators_registerAll(ALL_GENERATORS);
            expect(registry.generators_count()).toBe(ALL_GENERATORS.length);
        });

        it('should report false for unregistered key', () => {
            expect(registry.generator_has('nonexistent')).toBe(false);
        });
    });

    // ─── Content Resolution ──────────────────────────────────────

    describe('content_resolve', () => {
        it('should return null for unregistered key', () => {
            const result: string | null = registry.content_resolve('nonexistent', '/test');
            expect(result).toBeNull();
        });

        it('should resolve content for registered generator', () => {
            const gen: ContentGenerator = {
                pattern: 'hello',
                generate: (ctx: ContentContext): string => `Hello from ${ctx.filePath}`
            };
            registry.generator_register('hello', gen);
            const result: string | null = registry.content_resolve('hello', '/home/developer/hello.txt');
            expect(result).toBe('Hello from /home/developer/hello.txt');
        });
    });

    // ─── VFS Integration ─────────────────────────────────────────

    describe('vfs_connect', () => {
        it('should wire content resolver into VFS for lazy generation', () => {
            const vfs: VirtualFileSystem = new VirtualFileSystem('developer');
            const gen: ContentGenerator = {
                pattern: 'greeting',
                generate: (_ctx: ContentContext): string => 'Generated content'
            };
            registry.generator_register('greeting', gen);
            registry.vfs_connect(vfs);

            // Create a file with a contentGenerator key
            vfs.file_create('/home/developer/test.txt');
            const node = vfs.node_stat('/home/developer/test.txt');
            if (node) {
                node.contentGenerator = 'greeting';
                node.content = null;
            }

            // node_read should trigger lazy generation
            const content: string | null = vfs.node_read('/home/developer/test.txt');
            expect(content).toBe('Generated content');
        });

        it('should cache generated content on subsequent reads', () => {
            const vfs: VirtualFileSystem = new VirtualFileSystem('developer');
            let callCount: number = 0;
            const gen: ContentGenerator = {
                pattern: 'counter',
                generate: (_ctx: ContentContext): string => {
                    callCount++;
                    return `Call ${callCount}`;
                }
            };
            registry.generator_register('counter', gen);
            registry.vfs_connect(vfs);

            vfs.file_create('/home/developer/count.txt');
            const node = vfs.node_stat('/home/developer/count.txt');
            if (node) {
                node.contentGenerator = 'counter';
                node.content = null;
            }

            const first: string | null = vfs.node_read('/home/developer/count.txt');
            const second: string | null = vfs.node_read('/home/developer/count.txt');
            expect(first).toBe('Call 1');
            expect(second).toBe('Call 1'); // Cached, not regenerated
            expect(callCount).toBe(1);
        });
    });

    // ─── Template: train ─────────────────────────────────────────

    describe('train template', () => {
        beforeEach(() => {
            registry.generators_registerAll(ALL_GENERATORS);
        });

        it('should generate Python training script', () => {
            const content: string | null = registry.content_resolve('train', '/home/developer/src/project/train.py');
            expect(content).not.toBeNull();
            expect(content).toContain('import torch');
            expect(content).toContain('import meridian.federated as fl');
            expect(content).toContain('def train(cohort_id)');
            expect(content).toContain('EPOCHS = 50');
        });

        it('should include dataset names when available', () => {
            // The template reads from state.selectedDatasets which is empty in test
            // It should still produce valid output with placeholder
            const content: string | null = registry.content_resolve('train', '/train.py');
            expect(content).not.toBeNull();
            expect(content).toContain('COHORT_DATASETS');
        });
    });

    // ─── Template: readme ────────────────────────────────────────

    describe('readme template', () => {
        beforeEach(() => {
            registry.generators_registerAll(ALL_GENERATORS);
        });

        it('should generate Markdown README', () => {
            const content: string | null = registry.content_resolve('readme', '/README.md');
            expect(content).not.toBeNull();
            expect(content).toContain('# ');
            expect(content).toContain('Topology');
            expect(content).toContain('FedAvg');
            expect(content).toContain('Differential Privacy');
        });
    });

    // ─── Template: config ────────────────────────────────────────

    describe('config template', () => {
        beforeEach(() => {
            registry.generators_registerAll(ALL_GENERATORS);
        });

        it('should generate YAML configuration', () => {
            const content: string | null = registry.content_resolve('config', '/config.yaml');
            expect(content).not.toBeNull();
            expect(content).toContain('epochs: 50');
            expect(content).toContain('learning_rate: 0.001');
            expect(content).toContain('strategy: "FedAvg"');
            expect(content).toContain('differential_privacy: true');
        });
    });

    // ─── Template: requirements ──────────────────────────────────

    describe('requirements template', () => {
        beforeEach(() => {
            registry.generators_registerAll(ALL_GENERATORS);
        });

        it('should generate pip requirements', () => {
            const content: string | null = registry.content_resolve('requirements', '/requirements.txt');
            expect(content).not.toBeNull();
            expect(content).toContain('torch>=');
            expect(content).toContain('meridian-federated>=');
            expect(content).toContain('atlas-sdk>=');
        });
    });

    // ─── Template: manifest ──────────────────────────────────────

    describe('manifest template', () => {
        beforeEach(() => {
            registry.generators_registerAll(ALL_GENERATORS);
        });

        it('should generate JSON manifest', () => {
            const content: string | null = registry.content_resolve('manifest', '/manifest.json');
            expect(content).not.toBeNull();
            const parsed: any = JSON.parse(content!);
            expect(parsed.version).toBe('1.0.0');
            expect(parsed.federation.strategy).toBe('FedAvg');
            expect(parsed.security.differentialPrivacy.enabled).toBe(true);
        });
    });

    // ─── Template: catalog-datasets ──────────────────────────────

    describe('catalog-datasets template', () => {
        beforeEach(() => {
            registry.generators_registerAll(ALL_GENERATORS);
        });

        it('should generate JSON dataset catalog', () => {
            const content: string | null = registry.content_resolve('catalog-datasets', '/datasets.json');
            expect(content).not.toBeNull();
            const parsed: any[] = JSON.parse(content!);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBeGreaterThan(0);
            expect(parsed[0]).toHaveProperty('id');
            expect(parsed[0]).toHaveProperty('name');
            expect(parsed[0]).toHaveProperty('modality');
        });
    });

    // ─── Template: catalog-models ────────────────────────────────

    describe('catalog-models template', () => {
        beforeEach(() => {
            registry.generators_registerAll(ALL_GENERATORS);
        });

        it('should generate JSON model catalog', () => {
            const content: string | null = registry.content_resolve('catalog-models', '/models.json');
            expect(content).not.toBeNull();
            const parsed: any[] = JSON.parse(content!);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBe(4);
            expect(parsed[0]).toHaveProperty('id');
            expect(parsed[0]).toHaveProperty('framework');
        });
    });

    // ─── Template: node-registry ─────────────────────────────────

    describe('node-registry template', () => {
        beforeEach(() => {
            registry.generators_registerAll(ALL_GENERATORS);
        });

        it('should generate JSON node registry', () => {
            const content: string | null = registry.content_resolve('node-registry', '/nodes.json');
            expect(content).not.toBeNull();
            const parsed: any[] = JSON.parse(content!);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBeGreaterThan(0);
            expect(parsed[0]).toHaveProperty('id');
            expect(parsed[0]).toHaveProperty('name');
            expect(parsed[0]).toHaveProperty('institution');
        });
    });
});
