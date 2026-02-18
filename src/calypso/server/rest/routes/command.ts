/**
 * @file Command Route
 *
 * Handles command execution endpoint.
 *
 * @module
 */

import type { CalypsoResponse } from '../../../../lcarslm/types.js';
import { body_parse, bodyString_get, json_send } from '../http.js';
import type { RestRouteContext } from '../types.js';

/**
 * Handle `POST /calypso/command`.
 *
 * @param context - Route context.
 * @returns True if handled.
 */
export async function route_commandHandle(context: RestRouteContext): Promise<boolean> {
    if (context.pathname !== '/calypso/command' || context.method !== 'POST') {
        return false;
    }

    const body: Record<string, unknown> = await body_parse(context.req);
    const command: string | null = bodyString_get(body, 'command');
    if (!command) {
        json_send(context.res, { error: 'Missing "command" field' }, 400);
        return true;
    }

    const response: CalypsoResponse = await context.calypso.command_execute(command);
    json_send(context.res, response);
    return true;
}
