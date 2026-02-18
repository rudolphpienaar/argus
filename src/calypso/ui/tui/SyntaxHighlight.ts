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
import {
    language_fromPath,
    language_fromCatCommand,
    language_normalize,
    type LanguageId
} from '../../../core/syntax/languageRegistry.js';

/**
 * Infer syntax language from a filename/path extension.
 */
export function syntaxLanguage_fromPath(filePath: string): string | null {
    return language_fromPath(filePath);
}

/**
 * Detect `cat <path>` command language for direct file output highlighting.
 */
export function catLanguage_detect(input?: string): string | null {
    return language_fromCatCommand(input);
}

/**
 * Apply lightweight ANSI syntax highlighting for code content.
 */
export function syntaxHighlight_renderAnsi(code: string, language: string): string {
    let text: string = code;
    const lang: LanguageId = language_normalize(language) ?? 'text';
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

    if (lang === 'yaml') {
        maskWithColor(/#[^\n]*/g, COLORS.dim);
        maskWithColor(/(".*?"|'.*?')/g, COLORS.green);
        text = text.replace(/^(\s*[\w.-]+)(\s*:)/gm, `${COLORS.cyan}$1${COLORS.reset}$2`);
        text = text.replace(/\b(true|false|null|yes|no|on|off)\b/gi, `${COLORS.magenta}$1${COLORS.reset}`);
        text = text.replace(/\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi, `${COLORS.yellow}$1${COLORS.reset}`);
        restoreMasks();
        return text;
    }

    if (lang === 'bash') {
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

    if (lang === 'markdown') {
        text = text.replace(/^(#{1,6}\s+.+)$/gm, `${COLORS.cyan}$1${COLORS.reset}`);
        text = text.replace(/(\*\*[^*]+\*\*)/g, `${COLORS.bright}$1${COLORS.reset}`);
        text = text.replace(/(`[^`]+`)/g, `${COLORS.yellow}$1${COLORS.reset}`);
        return text;
    }

    // Generic fallback
    text = text.replace(/\b(-?\d+(?:\.\d+)?)\b/g, `${COLORS.yellow}$1${COLORS.reset}`);
    return text;
}
