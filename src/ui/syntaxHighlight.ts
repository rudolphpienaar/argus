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

/**
 * Applies syntax highlighting to plain-text file content.
 *
 * @param content  - Raw file content string.
 * @param filename - Filename used to determine language by extension.
 * @returns HTML string with syntax-highlighted `<span>` elements.
 */
export function syntax_highlight(content: string, filename: string): string {
    let escaped: string = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const ext: string = filename.split('.').pop()?.toLowerCase() || '';
    const tokens: Map<string, string> = new Map();
    let tokenIndex = 0;

    const mask = (str: string): string => {
        const key = `__TOKEN_${tokenIndex++}__`;
        tokens.set(key, str);
        return key;
    };

    if (ext === 'py') {
        // 1. Mask Strings (double and single quoted)
        escaped = escaped.replace(/(&quot;[^&]*?&quot;|"[^"]*?"|'[^']*?')/g, (match) => {
            return mask(`<span class="string">${match}</span>`);
        });

        // 2. Mask Comments
        escaped = escaped.replace(/(#[^\n]*)/g, (match) => {
            return mask(`<span class="comment">${match}</span>`);
        });

        // 3. Highlight Keywords (safe now that strings/comments are masked)
        const keywords = /\b(import|from|as|def|class|return|if|elif|else|for|while|in|not|and|or|True|False|None|with|try|except|raise|yield|lambda|pass|break|continue)\b/g;
        escaped = escaped.replace(keywords, '<span class="keyword">$1</span>');

        // 4. Highlight Numbers
        escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>');

        // 5. Restore Tokens
        tokens.forEach((val, key) => {
            escaped = escaped.replace(key, val);
        });

    } else if (ext === 'yaml' || ext === 'yml') {
        // 1. Mask Strings
        escaped = escaped.replace(/(".*?"|'.*?')/g, (match) => {
            return mask(`<span class="string">${match}</span>`);
        });

        // 2. Mask Comments
        escaped = escaped.replace(/(#[^\n]*)/g, (match) => {
            return mask(`<span class="comment">${match}</span>`);
        });

        // 3. Highlight Keys (the 'key:' part)
        escaped = escaped.replace(/^(\s*[\w_.-]+):/gm, (_match, p1) => {
            return `<span class="keyword">${p1}</span>:`;
        });

        // 4. Highlight Keywords (true, false, null)
        escaped = escaped.replace(/\b(true|false|null)\b/gi, '<span class="keyword">$1</span>');

        // 5. Highlight Numbers
        escaped = escaped.replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g, '<span class="number">$1</span>');

        // 6. Restore Tokens
        tokens.forEach((val, key) => {
            escaped = escaped.replace(key, val);
        });
    } else if (ext === 'json') {
        escaped = escaped.replace(/("(?:[^"\\]|\\.)*?")\s*:/g, '<span class="keyword">$1</span>:');
        escaped = escaped.replace(/:\s*("(?:[^"\\]|\\.)*?")/g, ': <span class="string">$1</span>');
        escaped = escaped.replace(/\b(true|false|null)\b/g, '<span class="keyword">$1</span>');
        escaped = escaped.replace(/\b(\d+\.?\d*(?:e[+-]?\d+)?)\b/g, '<span class="number">$1</span>');
    } else if (ext === 'md') {
        escaped = escaped.replace(/^(#{1,6}\s+.*$)/gm, '<span class="keyword">$1</span>');
        escaped = escaped.replace(/(\*\*.*?\*\*)/g, '<span class="function">$1</span>');
        escaped = escaped.replace(/(```[\s\S]*?```)/g, '<span class="string">$1</span>');
        escaped = escaped.replace(/(`[^`]+`)/g, '<span class="string">$1</span>');
    } else if (ext === 'csv') {
        // Highlight header row
        const lines: string[] = escaped.split('\n');
        if (lines.length > 0) {
            lines[0] = `<span class="keyword">${lines[0]}</span>`;
        }
        // Highlight quoted strings in data rows
        escaped = lines.join('\n');
        escaped = escaped.replace(/("(?:[^"\\]|\\.)*?")/g, '<span class="string">$1</span>');
        // Highlight numbers in unquoted fields
        escaped = escaped.replace(/(?<=,|^)(\d+\.?\d*(?:e[+-]?\d+)?)(?=,|$)/gm, '<span class="number">$1</span>');
    } else if (ext === 'txt') {
        escaped = escaped.replace(/(#[^\n]*)/g, '<span class="comment">$1</span>');
        escaped = escaped.replace(/^([\w-]+)/gm, '<span class="function">$1</span>');
        escaped = escaped.replace(/([><=!]+[\d.]+)/g, '<span class="number">$1</span>');
    }

    return escaped;
}
