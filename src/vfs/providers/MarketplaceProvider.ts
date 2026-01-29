/**
 * @file MarketplaceProvider — Asset Installation into VCS
 *
 * Installs marketplace assets into the appropriate VCS paths based
 * on asset type (plugin, dataset, model, annotation, fda).
 *
 * Replaces the inline `vfs.dir_create()` + `vfs.file_create()` calls
 * in `store.asset_install()`.
 *
 * All methods follow the RPN naming convention: <subject>_<verb>.
 *
 * @module
 */

import type { VirtualFileSystem } from '../VirtualFileSystem.js';
import type { FileNode } from '../types.js';

/**
 * Minimal asset interface — only the fields the provider needs.
 */
interface AssetInput {
    id: string;
    name: string;
    type: 'plugin' | 'dataset' | 'model' | 'workflow' | 'annotation' | 'fda';
    version: string;
    description: string;
    author: string;
    license: string;
}

/**
 * Installs a marketplace asset into the VCS filesystem.
 * Creates appropriate directory structure and files based on asset type.
 *
 * @param vfs - The VirtualFileSystem instance.
 * @param asset - The marketplace asset to install.
 * @param username - The persona username (default: 'developer').
 */
export function asset_install(vfs: VirtualFileSystem, asset: AssetInput, username: string = 'developer'): void {
    const home: string = `/home/${username}`;

    switch (asset.type) {
        case 'plugin':
            pluginAsset_install(vfs, asset);
            break;
        case 'dataset':
            datasetAsset_install(vfs, asset);
            break;
        case 'model':
            modelAsset_install(vfs, asset, home);
            break;
        case 'annotation':
            annotationAsset_install(vfs, asset);
            break;
        case 'fda':
            fdaAsset_install(vfs, asset);
            break;
        case 'workflow':
            workflowAsset_install(vfs, asset, home);
            break;
        default:
            // Unknown type — install as plugin fallback
            pluginAsset_install(vfs, asset);
            break;
    }
}

// ─── Type-Specific Installers ────────────────────────────────

/**
 * Installs a plugin asset as an executable in /bin/.
 *
 * @param vfs - The VirtualFileSystem instance.
 * @param asset - The plugin asset.
 */
function pluginAsset_install(vfs: VirtualFileSystem, asset: AssetInput): void {
    const binName: string = asset.name.toLowerCase().replace(/\s+/g, '-');
    const binPath: string = `/bin/${binName}`;
    vfs.dir_create('/bin');
    vfs.file_create(binPath);
    nodeMetadata_set(vfs, binPath, asset, 'plugin-executable');
}

/**
 * Installs a dataset asset into /data/sets/<name>/.
 *
 * @param vfs - The VirtualFileSystem instance.
 * @param asset - The dataset asset.
 */
function datasetAsset_install(vfs: VirtualFileSystem, asset: AssetInput): void {
    const dirName: string = asset.name.toLowerCase().replace(/\s+/g, '-');
    const dirPath: string = `/data/sets/${dirName}`;
    vfs.dir_create(dirPath);
    vfs.file_create(`${dirPath}/manifest.json`);
    nodeMetadata_set(vfs, `${dirPath}/manifest.json`, asset, 'dataset-manifest');
}

/**
 * Installs a model asset into ~/models/<name>/.
 *
 * @param vfs - The VirtualFileSystem instance.
 * @param asset - The model asset.
 * @param home - The user's home directory path.
 */
function modelAsset_install(vfs: VirtualFileSystem, asset: AssetInput, home: string): void {
    const dirName: string = asset.name.toLowerCase().replace(/\s+/g, '-');
    const dirPath: string = `${home}/models/${dirName}`;
    vfs.dir_create(dirPath);
    vfs.file_create(`${dirPath}/README.md`);
    nodeMetadata_set(vfs, `${dirPath}/README.md`, asset, 'model-readme');
}

/**
 * Installs an annotation tool into /data/annotations/<name>/.
 *
 * @param vfs - The VirtualFileSystem instance.
 * @param asset - The annotation tool asset.
 */
function annotationAsset_install(vfs: VirtualFileSystem, asset: AssetInput): void {
    const dirName: string = asset.name.toLowerCase().replace(/\s+/g, '-');
    const dirPath: string = `/data/annotations/${dirName}`;
    vfs.dir_create(dirPath);
    vfs.file_create(`${dirPath}/manifest.json`);
    nodeMetadata_set(vfs, `${dirPath}/manifest.json`, asset, 'annotation-manifest');
}

/**
 * Installs an FDA tool — both executable and data components.
 *
 * @param vfs - The VirtualFileSystem instance.
 * @param asset - The FDA tool asset.
 */
function fdaAsset_install(vfs: VirtualFileSystem, asset: AssetInput): void {
    // Executable
    pluginAsset_install(vfs, asset);
    // Data component
    annotationAsset_install(vfs, asset);
}

/**
 * Installs a workflow asset into ~/workflows/<name>/.
 *
 * @param vfs - The VirtualFileSystem instance.
 * @param asset - The workflow asset.
 * @param home - The user's home directory path.
 */
function workflowAsset_install(vfs: VirtualFileSystem, asset: AssetInput, home: string): void {
    const dirName: string = asset.name.toLowerCase().replace(/\s+/g, '-');
    const dirPath: string = `${home}/workflows/${dirName}`;
    vfs.dir_create(dirPath);
    vfs.file_create(`${dirPath}/workflow.yaml`);
    nodeMetadata_set(vfs, `${dirPath}/workflow.yaml`, asset, 'workflow-manifest');
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Sets metadata and content generator on an installed file node.
 *
 * @param vfs - The VirtualFileSystem instance.
 * @param filePath - Path of the file to annotate.
 * @param asset - The asset providing metadata.
 * @param generatorKey - ContentGenerator key for lazy content.
 */
function nodeMetadata_set(
    vfs: VirtualFileSystem,
    filePath: string,
    asset: AssetInput,
    generatorKey: string
): void {
    const node: FileNode | null = vfs.node_stat(filePath);
    if (node) {
        node.contentGenerator = generatorKey;
        node.content = null;
        node.metadata = {
            assetId: asset.id,
            assetType: asset.type,
            version: asset.version,
            author: asset.author
        };
    }
}
