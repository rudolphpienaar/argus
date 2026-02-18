/**
 * @file Plugin Handler Registry
 *
 * Canonical list and validation helpers for manifest/plugin handler names.
 *
 * @module plugins/registry
 */

/**
 * All supported plugin handler names.
 */
export const PLUGIN_HANDLER_NAMES = [
    'search',
    'gather',
    'rename',
    'harmonize',
    'scaffold',
    'train',
    'federation',
    'publish',
] as const;

/**
 * Valid plugin handler identifier.
 */
export type PluginHandlerName = (typeof PLUGIN_HANDLER_NAMES)[number];

const HANDLER_NAMES_SET: ReadonlySet<string> = new Set<string>(PLUGIN_HANDLER_NAMES);

/**
 * Type guard for known plugin handlers.
 */
export function pluginHandler_isKnown(handlerName: string): handlerName is PluginHandlerName {
    return HANDLER_NAMES_SET.has(handlerName);
}
