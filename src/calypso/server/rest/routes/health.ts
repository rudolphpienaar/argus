/**
 * @file Health Route
 *
 * Handles root health/status endpoint.
 *
 * @module
 */

import { json_send } from '../http.js';
import type { RestRouteContext } from '../types.js';

const HEALTH_ENDPOINTS: readonly string[] = [
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
];

/**
 * Handle root service health endpoint.
 *
 * @param context - Route context.
 * @returns True if handled.
 */
export async function route_healthHandle(context: RestRouteContext): Promise<boolean> {
    if (context.pathname !== '/' || context.method !== 'GET') {
        return false;
    }

    json_send(context.res, {
        service: 'Calypso Server',
        version: context.calypso.version_get(),
        status: 'running',
        endpoints: HEALTH_ENDPOINTS
    });
    return true;
}
