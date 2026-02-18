/**
 * @file syntaxHighlight — Shared Syntax Highlighting Utility
 *
 * Regex-based syntax highlighting for code preview across the UI.
 * Uses a token-masking strategy to prevent HTML tag collisions.
 *
 * Supported languages: Python, YAML, JSON, Markdown, CSV, plaintext.
 *
 * @module
 */

import { language_fromPath, type LanguageId } from '../core/syntax/languageRegistry.js';

function html_escape(content: string): string {
    return content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function highlight_python(escapedContent: string): string {
    let output: string = escapedContent;
    const tokens: Map<string, string> = new Map();
    let tokenIndex: number = 0;
    const mask = (maskedValue: string): string => {
        const key: string = `__TOKEN_${tokenIndex++}__`;
        tokens.set(key, maskedValue);
        return key;
    };

    output = output.replace(/(&quot;[^&]*?&quot;|"[^"]*?"|'[^']*?')/g, (match: string): string =>
        mask(`<span class="string">${match}</span>`)
    );
    output = output.replace(/(#[^\n]*)/g, (match: string): string =>
        mask(`<span class="comment">${match}</span>`)
    );
    output = output.replace(
        /\b(import|from|as|def|class|return|if|elif|else|for|while|in|not|and|or|True|False|None|with|try|except|raise|yield|lambda|pass|break|continue)\b/g,
        '<span class="keyword">$1</span>'
    );
    output = output.replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>');

    for (const [key, value] of tokens.entries()) {
        output = output.replace(key, value);
    }
    return output;
}

function highlight_yaml(escapedContent: string): string {
    let output: string = escapedContent;
    const tokens: Map<string, string> = new Map();
    let tokenIndex: number = 0;
    const mask = (maskedValue: string): string => {
        const key: string = `__TOKEN_${tokenIndex++}__`;
        tokens.set(key, maskedValue);
        return key;
    };

    output = output.replace(/(".*?"|'.*?')/g, (match: string): string =>
        mask(`<span class="string">${match}</span>`)
    );
    output = output.replace(/(#[^\n]*)/g, (match: string): string =>
        mask(`<span class="comment">${match}</span>`)
    );
    output = output.replace(/^(\s*[\w_.-]+):/gm, (_match: string, keyName: string): string =>
        `<span class="keyword">${keyName}</span>:`
    );
    output = output.replace(/\b(true|false|null)\b/gi, '<span class="keyword">$1</span>');
    output = output.replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g, '<span class="number">$1</span>');

    for (const [key, value] of tokens.entries()) {
        output = output.replace(key, value);
    }
    return output;
}

function highlight_json(escapedContent: string): string {
    let output: string = escapedContent;
    output = output.replace(/("(?:[^"\\]|\\.)*?")\s*:/g, '<span class="keyword">$1</span>:');
    output = output.replace(/:\s*("(?:[^"\\]|\\.)*?")/g, ': <span class="string">$1</span>');
    output = output.replace(/\b(true|false|null)\b/g, '<span class="keyword">$1</span>');
    output = output.replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g, '<span class="number">$1</span>');
    return output;
}

function highlight_markdown(escapedContent: string): string {
    let output: string = escapedContent;
    output = output.replace(/^(#{1,6}\s+.*$)/gm, '<span class="keyword">$1</span>');
    output = output.replace(/(\*\*.*?\*\*)/g, '<span class="function">$1</span>');
    output = output.replace(/(```[\s\S]*?```)/g, '<span class="string">$1</span>');
    output = output.replace(/(`[^`]+`)/g, '<span class="string">$1</span>');
    return output;
}

function highlight_csv(escapedContent: string): string {
    const lines: string[] = escapedContent.split('\n');
    if (lines.length > 0) {
        lines[0] = `<span class="keyword">${lines[0]}</span>`;
    }
    let output: string = lines.join('\n');
    output = output.replace(/("(?:[^"\\]|\\.)*?")/g, '<span class="string">$1</span>');
    output = output.replace(/(?<=,|^)(\d+\.?\d*(?:e[+-]?\d+)?)(?=,|$)/gm, '<span class="number">$1</span>');
    return output;
}

function highlight_text(escapedContent: string): string {
    let output: string = escapedContent;
    output = output.replace(/(#[^\n]*)/g, '<span class="comment">$1</span>');
    output = output.replace(/^([\w-]+)/gm, '<span class="function">$1</span>');
    output = output.replace(/([><=!]+[\d.]+)/g, '<span class="number">$1</span>');
    return output;
}

function highlight_byLanguage(escapedContent: string, language: LanguageId): string {
    switch (language) {
        case 'python':
            return highlight_python(escapedContent);
        case 'yaml':
            return highlight_yaml(escapedContent);
        case 'json':
            return highlight_json(escapedContent);
        case 'markdown':
            return highlight_markdown(escapedContent);
        case 'csv':
            return highlight_csv(escapedContent);
        case 'text':
            return highlight_text(escapedContent);
        default:
            return escapedContent;
    }
}

/**
 * Applies syntax highlighting to plain-text file content.
 *
 * @param content  - Raw file content string.
 * @param filename - Filename used to determine language by extension.
 * @returns HTML string with syntax-highlighted `<span>` elements.
 */
export function syntax_highlight(content: string, filename: string): string {
    const escapedContent: string = html_escape(content);
    const language: LanguageId | null = language_fromPath(filename);
    if (!language) {
        return escapedContent;
    }
    return highlight_byLanguage(escapedContent, language);
}
