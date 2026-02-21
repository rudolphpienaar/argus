/**
 * @file VCS Type Definitions
 *
 * Core interfaces for the Virtual Computer System (VCS).
 * Defines the data structures for the filesystem, shell, and content system.
 *
 * @module
 */

import type { Dataset, Project } from '../core/models/types.js';

/**
 * Represents a file or folder in the virtual filesystem.
 * Unlike the legacy FileNode, this carries content, permissions, and metadata.
 */
export interface FileNode {
    name: string;
    type: 'file' | 'folder' | 'link';
    path: string;
    target?: string; // For symlinks
    size: string;
    content: string | null;
    contentGenerator: string | null;
    permissions: 'rw' | 'ro';
    modified: Date;
    children: FileNode[] | null;
    metadata: Record<string, string>;
}

/**
 * Result of a shell command execution.
 */
export interface ShellResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

/**
 * Context passed to content generators for lazy file content creation.
 */
export interface ContentContext {
    filePath: string;
    persona: string;
    selectedDatasets: Dataset[];
    activeProject: Project | null;
    installedAssets: string[];
}

/**
 * A content generator registered with the ContentRegistry.
 */
export interface ContentGenerator {
    pattern: string | RegExp;
    generate: (context: ContentContext) => string;
}

/**
 * Payload for VFS_CHANGED events.
 */
export interface VfsChangeEvent {
    path: string;
    operation: 'write' | 'remove' | 'mkdir' | 'touch' | 'copy' | 'move' | 'mount' | 'unmount' | 'link';
}

/**
 * Payload for CWD_CHANGED events.
 */
export interface CwdChangeEvent {
    oldPath: string;
    newPath: string;
}
