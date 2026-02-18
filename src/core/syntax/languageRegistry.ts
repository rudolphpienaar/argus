/**
 * @file Syntax Language Registry
 *
 * Canonical language detection and language-to-filename mapping for both
 * browser and TUI syntax highlighting paths.
 *
 * @module
 */

export type LanguageId =
    | 'python'
    | 'json'
    | 'yaml'
    | 'markdown'
    | 'bash'
    | 'typescript'
    | 'javascript'
    | 'dockerfile'
    | 'makefile'
    | 'toml'
    | 'ini'
    | 'csv'
    | 'text';

const BASENAME_LANGUAGE_MAP: Readonly<Record<string, LanguageId>> = {
    'dockerfile': 'dockerfile',
    'makefile': 'makefile'
};

const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, LanguageId>> = {
    'py': 'python',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'markdown': 'markdown',
    'adoc': 'markdown',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'mjs': 'javascript',
    'cjs': 'javascript',
    'toml': 'toml',
    'ini': 'ini',
    'cfg': 'ini',
    'conf': 'ini',
    'csv': 'csv',
    'txt': 'text'
};

const LANGUAGE_ALIAS_MAP: Readonly<Record<string, LanguageId>> = {
    'python': 'python',
    'py': 'python',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'markdown': 'markdown',
    'md': 'markdown',
    'adoc': 'markdown',
    'bash': 'bash',
    'sh': 'bash',
    'zsh': 'bash',
    'shell': 'bash',
    'typescript': 'typescript',
    'ts': 'typescript',
    'javascript': 'javascript',
    'js': 'javascript',
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
    'toml': 'toml',
    'ini': 'ini',
    'cfg': 'ini',
    'conf': 'ini',
    'csv': 'csv',
    'text': 'text',
    'txt': 'text'
};

const LANGUAGE_FILENAME_MAP: Readonly<Record<LanguageId, string>> = {
    'python': 'snippet.py',
    'json': 'snippet.json',
    'yaml': 'snippet.yaml',
    'markdown': 'snippet.md',
    'bash': 'snippet.sh',
    'typescript': 'snippet.ts',
    'javascript': 'snippet.js',
    'dockerfile': 'Dockerfile',
    'makefile': 'Makefile',
    'toml': 'snippet.toml',
    'ini': 'snippet.ini',
    'csv': 'snippet.csv',
    'text': 'snippet.txt'
};

/**
 * Resolve canonical language ID from file path.
 *
 * @param filePath - Absolute or relative path.
 * @returns Language ID when recognized, otherwise null.
 */
export function language_fromPath(filePath: string): LanguageId | null {
    const baseName: string = filePath.split('/').pop()?.toLowerCase() || filePath.toLowerCase();
    const baseHit: LanguageId | undefined = BASENAME_LANGUAGE_MAP[baseName];
    if (baseHit) {
        return baseHit;
    }

    const dotIndex: number = baseName.lastIndexOf('.');
    if (dotIndex < 0) {
        return null;
    }

    const extension: string = baseName.slice(dotIndex + 1);
    return EXTENSION_LANGUAGE_MAP[extension] ?? null;
}

/**
 * Resolve canonical language ID from a `cat <path>` command.
 *
 * @param input - Command input line.
 * @returns Language ID when detected, otherwise null.
 */
export function language_fromCatCommand(input?: string): LanguageId | null {
    if (!input) {
        return null;
    }

    const tokens: RegExpMatchArray | null = input.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*')+/g);
    if (!tokens || tokens.length === 0) {
        return null;
    }
    if (tokens[0].toLowerCase() !== 'cat') {
        return null;
    }

    const fileToken: string | undefined = tokens.slice(1).find(
        (token: string): boolean => !token.startsWith('-')
    );
    if (!fileToken) {
        return null;
    }
    const normalizedPath: string = fileToken.replace(/^['"]|['"]$/g, '');
    return language_fromPath(normalizedPath);
}

/**
 * Normalize arbitrary language token to canonical language ID.
 *
 * @param language - Arbitrary language token.
 * @returns Canonical language ID or null.
 */
export function language_normalize(language: string): LanguageId | null {
    return LANGUAGE_ALIAS_MAP[language.toLowerCase()] ?? null;
}

/**
 * Resolve pseudo-filename used by highlighters for a given language token.
 *
 * @param language - Language token or canonical ID.
 * @returns Pseudo-filename with extension/basename suitable for detection.
 */
export function filename_forLanguage(language: string): string {
    const normalizedLanguage: LanguageId | null = language_normalize(language);
    return normalizedLanguage ? LANGUAGE_FILENAME_MAP[normalizedLanguage] : LANGUAGE_FILENAME_MAP.text;
}
