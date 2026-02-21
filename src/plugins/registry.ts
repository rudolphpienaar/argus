/**
 * @file Plugin Handler Registry
 *
 * Canonical list and validation helpers for manifest/plugin handler names.
 *
 * @module plugins/registry
 */

/** Valid plugin handler identifier. */
export type PluginHandlerName = string;

/**
 * Validate plugin handler identifier format.
 *
 * Runtime resolvability is checked by PluginHost dynamic import.
 */
export function pluginHandler_isKnown(handlerName: string): handlerName is PluginHandlerName {
    return /^[a-z][a-z0-9_-]*$/.test(handlerName);
}
