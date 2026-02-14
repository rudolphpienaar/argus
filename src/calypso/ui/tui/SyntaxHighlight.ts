/**
 * @file ANSI Syntax Highlighting
 *
 * Lightweight syntax highlighting for terminal output. Supports Python,
 * JSON, YAML, Bash, TypeScript/JavaScript, and Markdown with ANSI color
 * codes optimized for dark terminal backgrounds.
 *
 * @module
 */

import { COLORS } from './TuiRenderer.js';

/**
 * Infer syntax language from a filename/path extension.
 */
export function syntaxLanguage_fromPath(filePath: string): string | null {
    const basename: string = filePath.split('/').pop()?.toLowerCase() || '';
    if (basename === 'dockerfile') return 'dockerfile';
    if (basename === 'makefile') return 'makefile';

    const dotIdx = basename.lastIndexOf('.');
    if (dotIdx < 0) return null;
    const ext: string = basename.slice(dotIdx + 1);

    switch (ext) {
        case 'py':
            return 'python';
        case 'json':
            return 'json';
        case 'yaml':
        case 'yml':
            return 'yaml';
        case 'md':
        case 'markdown':
        case 'adoc':
            return 'markdown';
        case 'sh':
        case 'bash':
        case 'zsh':
            return 'bash';
        case 'ts':
        case 'tsx':
            return 'typescript';
        case 'js':
        case 'mjs':
        case 'cjs':
            return 'javascript';
        case 'toml':
            return 'toml';
        case 'ini':
        case 'cfg':
        case 'conf':
            return 'ini';
        case 'txt':
            return 'text';
        default:
            return null;
    }
}

/**
 * Detect `cat <path>` command language for direct file output highlighting.
 */
export function catLanguage_detect(input?: string): string | null {
    if (!input) return null;
    const tokens: RegExpMatchArray | null = input.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*')+/g);
    if (!tokens || tokens.length === 0) return null;
    if (tokens[0].toLowerCase() !== 'cat') return null;

    const fileToken: string | undefined = tokens.slice(1).find((token: string): boolean => !token.startsWith('-'));
    if (!fileToken) return null;
    const normalized: string = fileToken.replace(/^['"]|['"]$/g, '');
    return syntaxLanguage_fromPath(normalized);
}

/**
 * Apply lightweight ANSI syntax highlighting for code content.
 */
export function syntaxHighlight_renderAnsi(code: string, language: string): string {
    let text: string = code;
    const lang: string = language.toLowerCase();
    const masks: Map<string, string> = new Map();
    let maskIdx: number = 0;

    const maskWithColor = (pattern: RegExp, color: string): void => {
        text = text.replace(pattern, (match: string): string => {
            const key: string = `__SYNTAX_MASK_${maskIdx++}__`;
            masks.set(key, `${color}${match}${COLORS.reset}`);
            return key;
        });
    };

    const restoreMasks = (): void => {
        for (const [key, value] of masks.entries()) {
            text = text.replaceAll(key, value);
        }
    };

    if (lang === 'python') {
        maskWithColor(/("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, COLORS.yellow);
        maskWithColor(/#[^\n]*/g, COLORS.dim);
        text = text.replace(/\b(import|from|as|def|class|return|if|elif|else|for|while|in|not|and|or|True|False|None|with|try|except|raise|yield|lambda|pass|break|continue|async|await)\b/g, `${COLORS.magenta}$1${COLORS.reset}`);
        text = text.replace(/\b(\d+(?:\.\d+)?)\b/g, `${COLORS.cyan}$1${COLORS.reset}`);
        restoreMasks();
        return text;
    }

    if (lang === 'json') {
        text = text.replace(/"(?:[^"\\]|\\.)*"/g, (match: string, offset: number, source: string): string => {
            const remainder: string = source.slice(offset + match.length);
            const isKey: boolean = /^\s*:/.test(remainder);
            return isKey
                ? `${COLORS.cyan}${match}${COLORS.reset}`
                : `${COLORS.green}${match}${COLORS.reset}`;
        });
        text = text.replace(/\b(true|false|null)\b/gi, `${COLORS.magenta}$1${COLORS.reset}`);
        text = text.replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, `${COLORS.yellow}$1${COLORS.reset}`);
        return text;
    }

    if (lang === 'yaml' || lang === 'yml') {
        maskWithColor(/#[^\n]*/g, COLORS.dim);
        maskWithColor(/(".*?"|'.*?')/g, COLORS.green);
        text = text.replace(/^(\s*[\w.-]+)(\s*:)/gm, `${COLORS.cyan}$1${COLORS.reset}$2`);
        text = text.replace(/\b(true|false|null|yes|no|on|off)\b/gi, `${COLORS.magenta}$1${COLORS.reset}`);
        text = text.replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, `${COLORS.yellow}$1${COLORS.reset}`);
        restoreMasks();
        return text;
    }

    if (lang === 'bash' || lang === 'shell' || lang === 'zsh') {
        maskWithColor(/#[^\n]*/g, COLORS.dim);
        maskWithColor(/(".*?"|'.*?')/g, COLORS.green);
        text = text.replace(/\$(\w+|\{[^}]+\})/g, (match: string): string => `${COLORS.magenta}${match}${COLORS.reset}`);
        text = text.replace(/\b(if|then|else|fi|for|while|do|done|case|esac|function|return|export|local|in)\b/g, `${COLORS.blue}$1${COLORS.reset}`);
        restoreMasks();
        return text;
    }

    if (lang === 'typescript' || lang === 'javascript') {
        maskWithColor(/(".*?"|'.*?'|`[\s\S]*?`)/g, COLORS.green);
        maskWithColor(/\/\/[^\n]*/g, COLORS.dim);
        maskWithColor(/\/\*[\s\S]*?\*\//g, COLORS.dim);
        text = text.replace(/\b(import|from|export|const|let|var|function|class|return|if|else|for|while|switch|case|break|continue|new|try|catch|finally|async|await|interface|type)\b/g, `${COLORS.magenta}$1${COLORS.reset}`);
        text = text.replace(/\b(-?\d+(?:\.\d+)?)\b/g, `${COLORS.yellow}$1${COLORS.reset}`);
        restoreMasks();
        return text;
    }

    if (lang === 'markdown' || lang === 'md') {
        text = text.replace(/^(#{1,6}\s+.+)$/gm, `${COLORS.cyan}$1${COLORS.reset}`);
        text = text.replace(/(\*\*[^*]+\*\*)/g, `${COLORS.bright}$1${COLORS.reset}`);
        text = text.replace(/(`[^`]+`)/g, `${COLORS.yellow}$1${COLORS.reset}`);
        return text;
    }

    // Generic fallback
    text = text.replace(/\b(-?\d+(?:\.\d+)?)\b/g, `${COLORS.yellow}$1${COLORS.reset}`);
    return text;
}
