#!/usr/bin/env node
/**
 * @file Plugin Boundary Guard
 *
 * Enforces architectural boundaries for plugin modules.
 *
 * Rule:
 * - Files under `src/plugins/` must not import from `src/core/stages/*`.
 * - Files under `src/plugins/` must not import from `src/core/logic/*`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ file: string, specifier: string, line: number }} Violation */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const pluginsRoot = path.join(repoRoot, 'src', 'plugins');

/**
 * Recursively collect TypeScript source files.
 *
 * @param {string} rootDir - Directory to walk.
 * @returns {string[]} Absolute file paths.
 */
function tsFiles_collect(rootDir) {
    /** @type {string[]} */
    const files = [];
    /** @type {string[]} */
    const stack = [rootDir];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }

        for (const name of readdirSync(current)) {
            const fullPath = path.join(current, name);
            const stats = statSync(fullPath);
            if (stats.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (stats.isFile() && fullPath.endsWith('.ts')) {
                files.push(fullPath);
            }
        }
    }

    return files;
}

/**
 * Extract string-literal import specifiers from source text.
 *
 * @param {string} sourceText - File content.
 * @returns {Array<{specifier: string, line: number}>}
 */
function importSpecifiers_extract(sourceText) {
    /** @type {Array<{specifier: string, line: number}>} */
    const results = [];
    const importFromRegex = /from\s+['"]([^'"]+)['"]/g;
    const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

    for (const regex of [importFromRegex, dynamicImportRegex]) {
        let match;
        while ((match = regex.exec(sourceText)) !== null) {
            const specifier = match[1];
            const prefix = sourceText.slice(0, match.index);
            const line = prefix.split('\n').length;
            results.push({ specifier, line });
        }
    }

    return results;
}

/**
 * Determine whether an import specifier resolves into forbidden core modules.
 *
 * @param {string} sourceFile - Absolute source file path.
 * @param {string} specifier - Import path as written in source.
 * @returns {boolean}
 */
function isCoreImport_forbidden(sourceFile, specifier) {
    if (!specifier.startsWith('.')) {
        return specifier.includes('/core/stages/')
            || specifier.startsWith('core/stages/')
            || specifier.includes('/core/logic/')
            || specifier.startsWith('core/logic/');
    }

    const resolved = path.resolve(path.dirname(sourceFile), specifier);
    const normalized = resolved.split(path.sep).join('/');
    return normalized.includes('/src/core/stages/') || normalized.includes('/src/core/logic/');
}

/**
 * Execute boundary check and exit process with status code.
 */
function main() {
    /** @type {Violation[]} */
    const violations = [];

    for (const filePath of tsFiles_collect(pluginsRoot)) {
        const source = readFileSync(filePath, 'utf8');
        const specifiers = importSpecifiers_extract(source);

        for (const entry of specifiers) {
            if (!isCoreImport_forbidden(filePath, entry.specifier)) {
                continue;
            }

            violations.push({
                file: path.relative(repoRoot, filePath),
                specifier: entry.specifier,
                line: entry.line,
            });
        }
    }

    if (violations.length === 0) {
        console.log('Plugin boundary check passed.');
        process.exit(0);
    }

    console.error('Plugin boundary violations detected:');
    for (const violation of violations) {
        console.error(`- ${violation.file}:${violation.line} imports "${violation.specifier}"`);
    }
    console.error('Rule: src/plugins/* must not import src/core/stages/* or src/core/logic/*.');
    process.exit(1);
}

main();
