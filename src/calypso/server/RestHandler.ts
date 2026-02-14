/**
 * @file REST Route Handler
 *
 * Extracted REST endpoint handlers from calypso-server.ts.
 * Used by CalypsoServer for backward-compatible HTTP API.
 *
 * @module
 */

import http from 'http';
import { URL } from 'url';
import type { CalypsoCore } from '../../lcarslm/CalypsoCore.js';
import type { CalypsoResponse } from '../../lcarslm/types.js';

/**
 * Parse JSON body from request.
 */
async function body_parse(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer | string) => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * Send JSON response with CORS headers.
 */
function json_send(res: http.ServerResponse, data: unknown, status: number = 200): void {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data, null, 2));
}

export interface RestHandlerDeps {
    calypso_get: () => CalypsoCore;
    calypso_reinitialize: (username?: string) => CalypsoCore;
    host: string;
    port: number;
}

/**
 * Handle HTTP REST API requests.
 * Returns true if the request was handled, false if it should fall through.
 */
export async function restRequest_handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    deps: RestHandlerDeps
): Promise<boolean> {
    const url = new URL(req.url || '/', `http://${deps.host}:${deps.port}`);
    const pathname = url.pathname;
    const method = req.method || 'GET';

    // CORS preflight
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return true;
    }

    const calypso = deps.calypso_get();

    try {
        // POST /calypso/command
        if (pathname === '/calypso/command' && method === 'POST') {
            const body = await body_parse(req);
            const command = body.command as string;
            if (!command) {
                json_send(res, { error: 'Missing "command" field' }, 400);
                return true;
            }
            const response: CalypsoResponse = await calypso.command_execute(command);
            json_send(res, response);
            return true;
        }

        // GET /calypso/vfs/snapshot
        if (pathname === '/calypso/vfs/snapshot' && method === 'GET') {
            const rootPath = url.searchParams.get('path') || '/';
            const includeContent = url.searchParams.get('content') === 'true';
            const snapshot = calypso.vfs_snapshot(rootPath, includeContent);
            json_send(res, { snapshot });
            return true;
        }

        // GET /calypso/vfs/exists
        if (pathname === '/calypso/vfs/exists' && method === 'GET') {
            const checkPath = url.searchParams.get('path');
            if (!checkPath) {
                json_send(res, { error: 'Missing "path" parameter' }, 400);
                return true;
            }
            json_send(res, { exists: calypso.vfs_exists(checkPath), path: checkPath });
            return true;
        }

        // GET /calypso/vfs/read
        if (pathname === '/calypso/vfs/read' && method === 'GET') {
            const readPath = url.searchParams.get('path');
            if (!readPath) {
                json_send(res, { error: 'Missing "path" parameter' }, 400);
                return true;
            }
            json_send(res, { content: calypso.vfs_read(readPath), path: readPath });
            return true;
        }

        // GET /calypso/store/state
        if (pathname === '/calypso/store/state' && method === 'GET') {
            json_send(res, { state: calypso.store_snapshot() });
            return true;
        }

        // GET /calypso/store/get
        if (pathname === '/calypso/store/get' && method === 'GET') {
            const property = url.searchParams.get('property');
            if (!property) {
                json_send(res, { error: 'Missing "property" parameter' }, 400);
                return true;
            }
            const state = calypso.store_snapshot();
            const value = (state as Record<string, unknown>)[property];
            json_send(res, { property, value });
            return true;
        }

        // POST /calypso/reset
        if (pathname === '/calypso/reset' && method === 'POST') {
            deps.calypso_reinitialize();
            json_send(res, { message: 'System reset to clean state' });
            return true;
        }

        // GET /calypso/version
        if (pathname === '/calypso/version' && method === 'GET') {
            json_send(res, { version: calypso.version_get() });
            return true;
        }

        // GET /calypso/prompt
        if (pathname === '/calypso/prompt' && method === 'GET') {
            json_send(res, { prompt: calypso.prompt_get() });
            return true;
        }

        // POST /calypso/login
        if (pathname === '/calypso/login' && method === 'POST') {
            const body = await body_parse(req);
            const username: string = (body.username as string) || 'developer';
            const sanitized: string = username.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'developer';
            deps.calypso_reinitialize(sanitized);
            const newCalypso = deps.calypso_get();
            console.log(`Login: User "${sanitized}" authenticated`);
            json_send(res, {
                message: 'Login successful',
                username: sanitized,
                workflows: newCalypso.workflows_available()
            });
            return true;
        }

        // POST /calypso/persona
        if (pathname === '/calypso/persona' && method === 'POST') {
            const body = await body_parse(req);
            const workflowId: string | null = (body.workflowId as string) || null;

            if (workflowId === 'none' || workflowId === 'skip' || !workflowId) {
                calypso.workflow_set(null);
                console.log(`Persona: Workflow guidance disabled`);
                json_send(res, { message: 'Workflow guidance disabled', workflow: null });
            } else {
                const success = calypso.workflow_set(workflowId);
                if (success) {
                    const workflows = calypso.workflows_available();
                    const selected = workflows.find(w => w.id === workflowId);
                    console.log(`Persona: Workflow set to "${workflowId}"`);
                    json_send(res, { message: `Workflow set: ${selected?.name || workflowId}`, workflow: selected });
                } else {
                    json_send(res, { error: `Unknown workflow: ${workflowId}` }, 400);
                }
            }
            return true;
        }

        // GET /calypso/workflows
        if (pathname === '/calypso/workflows' && method === 'GET') {
            json_send(res, { workflows: calypso.workflows_available() });
            return true;
        }

        // GET / - Health check
        if (pathname === '/' && method === 'GET') {
            json_send(res, {
                service: 'Calypso Server',
                version: calypso.version_get(),
                status: 'running',
                endpoints: [
                    'POST /calypso/command',
                    'POST /calypso/login',
                    'POST /calypso/persona',
                    'GET  /calypso/vfs/snapshot',
                    'GET  /calypso/vfs/exists',
                    'GET  /calypso/vfs/read',
                    'GET  /calypso/store/state',
                    'GET  /calypso/store/get',
                    'POST /calypso/reset',
                    'GET  /calypso/version',
                    'GET  /calypso/prompt',
                    'GET  /calypso/workflows',
                    'WS   /calypso/ws'
                ]
            });
            return true;
        }

    } catch (e: unknown) {
        const error = e instanceof Error ? e.message : 'Unknown error';
        json_send(res, { error }, 500);
        return true;
    }

    // Not handled — fall through to 404
    return false;
}
