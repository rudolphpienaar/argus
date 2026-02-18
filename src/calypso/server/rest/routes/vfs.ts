/**
 * @file VFS Routes
 *
 * Handles filesystem inspection/read endpoints.
 *
 * @module
 */

import { json_send } from '../http.js';
import type { RestRouteContext } from '../types.js';

/**
 * Handle VFS routes under `/calypso/vfs/*`.
 *
 * @param context - Route context.
 * @returns True if handled.
 */
export async function route_vfsHandle(context: RestRouteContext): Promise<boolean> {
    if (!context.pathname.startsWith('/calypso/vfs/')) {
        return false;
    }

    if (context.pathname === '/calypso/vfs/snapshot' && context.method === 'GET') {
        const rootPath: string = context.url.searchParams.get('path') || '/';
        const includeContent: boolean = context.url.searchParams.get('content') === 'true';
        const snapshot: unknown = context.calypso.vfs_snapshot(rootPath, includeContent);
        json_send(context.res, { snapshot });
        return true;
    }

    if (context.pathname === '/calypso/vfs/exists' && context.method === 'GET') {
        const checkPath: string | null = context.url.searchParams.get('path');
        if (!checkPath) {
            json_send(context.res, { error: 'Missing "path" parameter' }, 400);
            return true;
        }
        json_send(context.res, { exists: context.calypso.vfs_exists(checkPath), path: checkPath });
        return true;
    }

    if (context.pathname === '/calypso/vfs/read' && context.method === 'GET') {
        const readPath: string | null = context.url.searchParams.get('path');
        if (!readPath) {
            json_send(context.res, { error: 'Missing "path" parameter' }, 400);
            return true;
        }
        json_send(context.res, { content: context.calypso.vfs_read(readPath), path: readPath });
        return true;
    }

    return false;
}
