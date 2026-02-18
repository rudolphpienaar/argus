/**
 * @file Store Routes
 *
 * Handles store snapshot/property read endpoints.
 *
 * @module
 */

import { json_send } from '../http.js';
import type { RestRouteContext } from '../types.js';

/**
 * Handle store routes under `/calypso/store/*`.
 *
 * @param context - Route context.
 * @returns True if handled.
 */
export async function route_storeHandle(context: RestRouteContext): Promise<boolean> {
    if (context.pathname === '/calypso/store/state' && context.method === 'GET') {
        json_send(context.res, { state: context.calypso.store_snapshot() });
        return true;
    }

    if (context.pathname === '/calypso/store/get' && context.method === 'GET') {
        const property: string | null = context.url.searchParams.get('property');
        if (!property) {
            json_send(context.res, { error: 'Missing "property" parameter' }, 400);
            return true;
        }

        const state: Record<string, unknown> = context.calypso.store_snapshot() as Record<string, unknown>;
        json_send(context.res, { property, value: state[property] });
        return true;
    }

    return false;
}
