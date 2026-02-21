/**
 * Shared helpers for VFS shell builtin command modules.
 *
 * These utilities deliberately stay tiny and dependency-free so each builtin
 * can remain self-contained while still sharing common parsing/formatting logic.
 */

/**
 * Convert unknown thrown values into display-safe messages.
 *
 * Builtins catch broad `unknown` errors from VFS/system APIs and normalize them
 * into shell stderr output through this helper.
 */
export function errorMessage_get(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Return the basename segment from an absolute or relative path string.
 */
export function pathBasename_get(path: string): string {
    const normalized: string = path.replace(/\/+$/, '');
    const index: number = normalized.lastIndexOf('/');
    return index === -1 ? normalized : normalized.slice(index + 1);
}

/**
 * Test whether an argument should be treated as an option token.
 *
 * A lone '-' is considered a positional operand, not an option.
 */
export function argIsOption_check(arg: string, parseOptions: boolean): boolean {
    return parseOptions && arg.startsWith('-') && arg !== '-';
}
