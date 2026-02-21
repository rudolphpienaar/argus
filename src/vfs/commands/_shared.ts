/**
 * Convert unknown thrown values into display-safe messages.
 */
export function errorMessage_get(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
