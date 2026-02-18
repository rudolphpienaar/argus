/**
 * @file REST Route Handler
 *
 * HTTP entrypoint for Calypso REST routes.
 * Delegates route-specific logic to focused route modules.
 *
 * @module
 */

import http from 'http';
import { URL } from 'url';
import { route_commandHandle } from './rest/routes/command.js';
import { route_healthHandle } from './rest/routes/health.js';
import { route_sessionHandle } from './rest/routes/session.js';
import { route_storeHandle } from './rest/routes/store.js';
import { route_vfsHandle } from './rest/routes/vfs.js';
import { route_workflowHandle } from './rest/routes/workflow.js';
import { corsPreflight_handle, errorMessage_get, json_send } from './rest/http.js';
import type { RestHandlerDeps, RestRouteContext, RestRouteHandler } from './rest/types.js';

const REST_ROUTE_HANDLERS: ReadonlyArray<RestRouteHandler> = [
    route_commandHandle,
    route_vfsHandle,
    route_storeHandle,
    route_sessionHandle,
    route_workflowHandle,
    route_healthHandle
];

/**
 * Handle HTTP REST API requests.
 * Returns true if the request was handled, false if it should fall through.
 */
export async function restRequest_handle(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    deps: RestHandlerDeps
): Promise<boolean> {
    const url: URL = new URL(req.url || '/', `http://${deps.host}:${deps.port}`);
    const pathname: string = url.pathname;
    const method: string = req.method || 'GET';

    if (corsPreflight_handle(method, res)) {
        return true;
    }

    const context: RestRouteContext = {
        req,
        res,
        deps,
        url,
        pathname,
        method,
        calypso: deps.calypso_get()
    };

    try {
        for (const routeHandle of REST_ROUTE_HANDLERS) {
            const routeHandleTyped: RestRouteHandler = routeHandle;
            const handled: boolean = await routeHandleTyped(context);
            if (handled) {
                return true;
            }
        }
    } catch (error: unknown) {
        json_send(res, { error: errorMessage_get(error) }, 500);
        return true;
    }

    return false;
}
