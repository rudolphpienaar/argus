/**
 * @file Virtual Filesystem Logic
 * 
 * Implements a lightweight in-memory filesystem for the terminal and UI.
 * 
 * @module
 */

import type { FileNode } from '../models/types.js';

export class VirtualFileSystem {
    private root: FileNode;
    private cwdPath: string[];

    constructor() {
        this.root = {
            name: 'root',
            type: 'folder',
            path: '/',
            children: [
                {
                    name: 'home',
                    type: 'folder',
                    path: '/home',
                    children: [
                        {
                            name: 'developer',
                            type: 'folder',
                            path: '/home/developer',
                            children: [
                                { name: 'projects', type: 'folder', path: '/home/developer/projects', children: [] },
                                { name: 'README.md', type: 'file', path: '/home/developer/README.md', size: '1.2 KB' }
                            ]
                        }
                    ]
                }
            ]
        };
        this.cwdPath = ['home', 'developer'];
    }

    /**
     * Resolves a node from a path array.
     */
    public resolve(pathParts: string[]): FileNode | null {
        let current = this.root;
        // Handle absolute vs relative (simplified: assumes pathParts starts after root if absolute?)
        // Actually, our pathParts usually implies relative to root children.
        // Let's standardise: pathParts should be ['home', 'developer'] etc.
        
        for (const part of pathParts) {
            if (!current.children) return null;
            const next = current.children.find(c => c.name === part);
            if (!next) return null;
            current = next;
        }
        return current;
    }

    public getCwd(): string {
        return '/' + this.cwdPath.join('/');
    }

    public getCwdNode(): FileNode | null {
        return this.resolve(this.cwdPath);
    }

    public cd(pathStr: string): string {
        if (!pathStr) return this.getCwd();

        // 1. Determine starting point
        let targetPath: string[] = [];
        if (pathStr.startsWith('/')) {
            targetPath = []; // Root
            // Remove leading slash for splitting
            pathStr = pathStr.substring(1);
        } else if (pathStr.startsWith('~')) {
            targetPath = ['home', 'developer'];
            if (pathStr === '~') pathStr = '';
            else pathStr = pathStr.substring(2); // Remove ~/
        } else {
            targetPath = [...this.cwdPath];
        }

        // 2. Parse segments
        if (pathStr) {
            const segments = pathStr.split('/');
            for (const segment of segments) {
                if (segment === '' || segment === '.') continue;
                if (segment === '..') {
                    if (targetPath.length > 0) targetPath.pop();
                } else {
                    targetPath.push(segment);
                }
            }
        }

        // 3. Verify validity
        const node = this.resolve(targetPath);
        if (node && node.type === 'folder') {
            this.cwdPath = targetPath;
            return this.getCwd();
        } else {
            throw new Error(`cd: ${pathStr}: No such directory`);
        }
    }

    public mkdir(path: string): void {
        const current = this.getCwdNode();
        if (!current || !current.children) return;
        
        if (current.children.some(c => c.name === path)) {
            throw new Error(`mkdir: cannot create directory '${path}': File exists`);
        }
        
        current.children.push({
            name: path,
            type: 'folder',
            path: `${this.getCwd()}/${path}`,
            children: []
        });
    }

    public touch(name: string): void {
        const current = this.getCwdNode();
        if (!current || !current.children) return;
        
        if (!current.children.some(c => c.name === name)) {
            current.children.push({
                name: name,
                type: 'file',
                path: `${this.getCwd()}/${name}`,
                size: '0 B'
            });
        }
    }

    /**
     * Mounts a project structure at a specific path.
     */
    public mountProject(projectName: string, structure: FileNode): void {
        const projectsDir = this.resolve(['home', 'developer', 'projects']);
        if (projectsDir && projectsDir.children) {
            // Remove existing if any (overwrite)
            projectsDir.children = projectsDir.children.filter(c => c.name !== projectName);
            
            // Re-parent the structure
            structure.name = projectName;
            structure.path = `/home/developer/projects/${projectName}`;
            
            projectsDir.children.push(structure);
        }
    }
}
