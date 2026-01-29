/**
 * @file ContentRegistry — Lazy Content Resolution for VCS Files
 *
 * Maps generator keys (stored on FileNode.contentGenerator) to template
 * functions that produce file content on demand. When the VFS encounters
 * a file with a null content field but a non-null contentGenerator key,
 * it delegates to this registry via the ContentResolver callback.
 *
 * All methods follow the RPN naming convention: <subject>_<verb>.
 *
 * @module
 */

import type { ContentContext, ContentGenerator } from '../types.js';
import { state, globals } from '../../core/state/store.js';

/**
 * Central registry for lazy content generators.
 *
 * Templates register themselves by key (e.g., 'train', 'readme').
 * The VFS calls the resolver callback when it needs content for a file
 * whose `contentGenerator` matches a registered key.
 *
 * @example
 * ```typescript
 * const registry = new ContentRegistry();
 * registry.generator_register('train', {
 *     pattern: 'train',
 *     generate: (ctx) => `# Training script for ${ctx.persona}`
 * });
 * registry.vfs_connect(globals.vcs);
 * ```
 */
export class ContentRegistry {
    private generators: Map<string, ContentGenerator> = new Map();

    /**
     * Registers a content generator by key.
     *
     * @param key - The generator key (matches FileNode.contentGenerator).
     * @param generator - The generator definition with pattern and generate function.
     */
    public generator_register(key: string, generator: ContentGenerator): void {
        this.generators.set(key, generator);
    }

    /**
     * Registers multiple content generators at once.
     *
     * @param entries - Array of [key, generator] tuples.
     */
    public generators_registerAll(entries: Array<[string, ContentGenerator]>): void {
        for (const [key, generator] of entries) {
            this.generators.set(key, generator);
        }
    }

    /**
     * Connects this registry to the VFS by injecting the content resolver.
     * Must be called after both the VFS and all generators are initialized.
     *
     * @param vfs - The VirtualFileSystem instance to connect to.
     */
    public vfs_connect(vfs: { contentResolver_set: (resolver: (key: string, path: string) => string | null) => void }): void {
        vfs.contentResolver_set((generatorKey: string, filePath: string): string | null => {
            return this.content_resolve(generatorKey, filePath);
        });
    }

    /**
     * Resolves content for a given generator key and file path.
     * Builds a ContentContext from current application state and
     * invokes the registered generator.
     *
     * @param generatorKey - The generator key from FileNode.contentGenerator.
     * @param filePath - The absolute path of the file being read.
     * @returns Generated content string, or null if no generator is registered.
     */
    public content_resolve(generatorKey: string, filePath: string): string | null {
        const generator: ContentGenerator | undefined = this.generators.get(generatorKey);
        if (!generator) {
            return null;
        }

        const context: ContentContext = this.context_build(filePath);
        return generator.generate(context);
    }

    /**
     * Returns the number of registered generators.
     *
     * @returns Count of registered generators.
     */
    public generators_count(): number {
        return this.generators.size;
    }

    /**
     * Checks whether a generator is registered for the given key.
     *
     * @param key - The generator key to check.
     * @returns True if a generator is registered for this key.
     */
    public generator_has(key: string): boolean {
        return this.generators.has(key);
    }

    // ─── Internal Helpers ───────────────────────────────────────

    /**
     * Builds a ContentContext from current application state.
     *
     * @param filePath - The absolute path of the file being generated.
     * @returns A populated ContentContext for template evaluation.
     */
    private context_build(filePath: string): ContentContext {
        return {
            filePath,
            persona: state.currentPersona || 'developer',
            selectedDatasets: state.selectedDatasets || [],
            activeProject: state.activeProject || null,
            installedAssets: state.installedAssets || []
        };
    }
}
