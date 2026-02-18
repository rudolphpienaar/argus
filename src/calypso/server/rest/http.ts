/**
 * @file REST HTTP Helpers
 *
 * Transport-layer helpers used by REST route handlers.
 *
 * @module
 */

import http from 'http';

const CORS_HEADERS: Readonly<Record<string, string>> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

/**
 * Parse a JSON request body into a plain object.
 *
 * @param req - Incoming HTTP request.
 * @returns Parsed JSON payload.
 */
export async function body_parse(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise(
        (
            resolve: (value: Record<string, unknown>) => void,
            reject: (reason?: unknown) => void
        ): void => {
            let body: string = '';
            req.on('data', (chunk: Buffer | string): void => {
                body += chunk;
            });
            req.on('end', (): void => {
                try {
                    const parsed: Record<string, unknown> = body ? JSON.parse(body) as Record<string, unknown> : {};
                    resolve(parsed);
                } catch {
                    reject(new Error('Invalid JSON'));
                }
            });
            req.on('error', (error: Error): void => {
                reject(error);
            });
        }
    );
}

/**
 * Write a JSON response with standard CORS headers.
 *
 * @param res - HTTP response object.
 * @param data - Serializable response payload.
 * @param status - HTTP status code.
 */
export function json_send(res: http.ServerResponse, data: unknown, status: number = 200): void {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        ...CORS_HEADERS
    });
    res.end(JSON.stringify(data, null, 2));
}

/**
 * Handle CORS preflight request.
 *
 * @param method - HTTP method.
 * @param res - HTTP response object.
 * @returns True if request was handled as preflight.
 */
export function corsPreflight_handle(method: string, res: http.ServerResponse): boolean {
    if (method !== 'OPTIONS') {
        return false;
    }

    res.writeHead(204, CORS_HEADERS);
    res.end();
    return true;
}

/**
 * Read a string field from a JSON body.
 *
 * @param body - Parsed JSON body.
 * @param key - Target property key.
 * @returns String value if present, otherwise null.
 */
export function bodyString_get(body: Record<string, unknown>, key: string): string | null {
    const value: unknown = body[key];
    return typeof value === 'string' ? value : null;
}

/**
 * Convert unknown error payload to display-safe message text.
 *
 * @param error - Unknown error value.
 * @returns Resolved message.
 */
export function errorMessage_get(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
}
