/**
 * @file ProjectProvider — Home Directory Scaffolding & Project Population
 *
 * Scaffolds the user's home directory structure at login and populates
 * `~/projects/{name}/src/` with lazy-content project files at Process stage entry.
 *
 * All methods follow the RPN naming convention: <subject>_<verb>.
 *
 * @module
 */

import type { VirtualFileSystem } from '../VirtualFileSystem.js';
import type { FileNode } from '../types.js';
import type { Project } from '../../core/models/types.js';
import { MOCK_PROJECTS } from '../../core/data/projects.js';

/**
 * Scaffolds the home directory structure for a persona.
 * Creates well-known subdirectories and configuration files.
 *
 * Called at login after VFS and Shell are initialized.
 *
 * @param vfs - The VirtualFileSystem instance.
 * @param username - The persona username (default: 'developer').
 */
export function homeDir_scaffold(vfs: VirtualFileSystem, username: string = 'user'): void {
    const home: string = `/home/${username}`;

    // Well-known directories
    const dirs: string[] = [
        `${home}/bin`,
        `${home}/data`,
        `${home}/data/catalog`,
        `${home}/models`,
        `${home}/results`,
        `${home}/projects`,
        `${home}/.config`
    ];

    for (const dir of dirs) {
        vfs.dir_create(dir);
    }

    // System directories
    vfs.dir_create('/etc/atlas');
    vfs.dir_create('/bin');
    vfs.dir_create('/tmp');

    // Configuration file with content generator
    vfs.file_create(`${home}/.config/argus.yaml`);
    const configNode: FileNode | null = vfs.node_stat(`${home}/.config/argus.yaml`);
    if (configNode) {
        configNode.contentGenerator = 'argus-config';
        configNode.content = null;
    }

    // Catalog files with content generators
    vfs.file_create(`${home}/data/catalog/datasets.json`);
    const dsNode: FileNode | null = vfs.node_stat(`${home}/data/catalog/datasets.json`);
    if (dsNode) {
        dsNode.contentGenerator = 'catalog-datasets';
        dsNode.content = null;
    }

    vfs.file_create(`${home}/data/catalog/models.json`);
    const modelsNode: FileNode | null = vfs.node_stat(`${home}/data/catalog/models.json`);
    if (modelsNode) {
        modelsNode.contentGenerator = 'catalog-models';
        modelsNode.content = null;
    }

    // System node registry
    vfs.file_create('/etc/atlas/nodes.json');
    const nodesNode: FileNode | null = vfs.node_stat('/etc/atlas/nodes.json');
    if (nodesNode) {
        nodesNode.contentGenerator = 'node-registry';
        nodesNode.content = null;
    }

    // Mount existing projects from mock repository
    projects_mount(vfs, username, MOCK_PROJECTS);
}

/**
 * Mounts existing projects into the VFS at ~/projects/{name}/.
 * Creates a basic project structure for each project.
 *
 * @param vfs - The VirtualFileSystem instance.
 * @param username - The persona username.
 * @param projects - Array of projects to mount.
 */
export function projects_mount(vfs: VirtualFileSystem, username: string, projects: Project[]): void {
    const projectsDir: string = `/home/${username}/projects`;

    for (const project of projects) {
        const projectPath: string = `${projectsDir}/${project.name}`;
        const srcPath: string = `${projectPath}/src`;

        // Create project directory structure
        vfs.dir_create(projectPath);
        vfs.dir_create(srcPath);
        vfs.dir_create(`${srcPath}/.meridian`);
        vfs.dir_create(`${projectPath}/data`);
        vfs.dir_create(`${projectPath}/results`);

        // Create project metadata file
        vfs.file_create(`${projectPath}/project.json`);
        const metaNode: FileNode | null = vfs.node_stat(`${projectPath}/project.json`);
        if (metaNode) {
            metaNode.content = JSON.stringify({
                id: project.id,
                name: project.name,
                description: project.description,
                created: project.created.toISOString(),
                lastModified: project.lastModified.toISOString(),
                datasetCount: project.datasets.length
            }, null, 2);
        }

        // Create README with project info
        vfs.file_create(`${projectPath}/README.md`);
        const readmeNode: FileNode | null = vfs.node_stat(`${projectPath}/README.md`);
        if (readmeNode) {
            const datasetList: string = project.datasets.map(d => `- ${d.name} (${d.provider})`).join('\n');
            readmeNode.content = `# ${project.name}\n\n${project.description}\n\n## Datasets\n\n${datasetList}\n`;
        }

        // Project files with content generators
        const files: Array<[string, string]> = [
            ['src/train.py', 'train'],
            ['src/config.yaml', 'config'],
            ['src/requirements.txt', 'requirements'],
            ['src/.meridian/manifest.json', 'manifest']
        ];

        for (const [fileName, generatorKey] of files) {
            const filePath: string = `${projectPath}/${fileName}`;
            vfs.file_create(filePath);
            const node: FileNode | null = vfs.node_stat(filePath);
            if (node) {
                node.contentGenerator = generatorKey;
                node.content = null;
            }
        }
    }
}

/**
 * Populates the `~/projects/{projectName}/src/` directory with project files.
 * Each file uses a contentGenerator key for lazy content via the ContentRegistry.
 *
 * Called when entering the Process stage.
 *
 * @param vfs - The VirtualFileSystem instance.
 * @param username - The persona username (default: 'user').
 * @param projectName - The active project name (default: 'default').
 */
export function projectDir_populate(vfs: VirtualFileSystem, username: string = 'user', projectName: string = 'default'): void {
    const projectPath: string = `/home/${username}/projects/${projectName}/src`;

    // Ensure project directory exists
    vfs.dir_create(projectPath);
    vfs.dir_create(`${projectPath}/.meridian`);

    // Project files with content generators
    const files: Array<[string, string]> = [
        ['train.py', 'train'],
        ['config.yaml', 'config'],
        ['requirements.txt', 'requirements'],
        ['README.md', 'readme'],
        ['.meridian/manifest.json', 'manifest']
    ];

    for (const [fileName, generatorKey] of files) {
        const filePath: string = `${projectPath}/${fileName}`;
        vfs.file_create(filePath);
        const node: FileNode | null = vfs.node_stat(filePath);
        if (node) {
            node.contentGenerator = generatorKey;
            node.content = null;
        }
    }
}

/**
 * Content generator for ~/.config/argus.yaml.
 * Returns a YAML configuration with persona defaults.
 *
 * Registered with key 'argus-config' in the ContentRegistry.
 */
export const argusConfigContent: string = `# ARGUS Configuration
# Generated by VCS ProjectProvider

interface:
  theme: "lcars-classic"
  terminal_height: 600
  beckon_pulse: true

federation:
  default_strategy: "FedAvg"
  default_epochs: 50
  privacy:
    differential_privacy: true
    epsilon: 3.0

telemetry:
  enabled: true
  interval_ms: 1000
`;
