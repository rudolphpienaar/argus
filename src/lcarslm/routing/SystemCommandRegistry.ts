/**
 * @file System Command Registry
 *
 * Registry for OS-level commands (e.g., /reset, /snapshot, /session)
 * that are not workflow-routed or shell-native.
 *
 * @module lcarslm/routing/SystemCommandRegistry
 */

import type { CalypsoResponse, CalypsoStoreActions, CalypsoAction } from '../types.js';
import type { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import type { Shell } from '../../vfs/Shell.js';
import { CalypsoStatusCode } from '../types.js';
import { vfs_snapshot } from '../utils/VfsUtils.js';
import type { VfsSnapshotNode } from '../types.js';
import type { StatusProvider } from '../StatusProvider.js';
import type { SettingsService } from '../../config/settings.js';
import { WorkflowAdapter, type WorkflowSummary, type DagRenderOptions } from '../../dag/bridge/WorkflowAdapter.js';
import type { WorkflowSession } from '../../dag/bridge/WorkflowSession.js';
import type { MerkleEngine } from '../MerkleEngine.js';

interface DagCommandOptions {
    includeStructural: boolean;
    includeOptional: boolean;
    compact: boolean;
    box: boolean;
    showWhere: boolean;
    showStale: boolean;
    manifestId: string | null;
}

/**
 * Execution context provided to system command handlers.
 */
export interface SystemCommandContext {
    vfs: VirtualFileSystem;
    shell: Shell;
    storeActions: CalypsoStoreActions;
    statusProvider: StatusProvider;
    settingsService: SettingsService;
    workflowAdapter: WorkflowAdapter;
    workflowSession: WorkflowSession;
    merkleEngine: MerkleEngine;
    sessionPath: string;
    activeProvider: 'openai' | 'gemini' | null;
    activeModel: string | null;
    engineAvailable: boolean;

    /** Resolver for the current username. */
    username_resolve: () => string;
    /** Callback to realign the session after mutations (like reset or resume). */
    session_realign: () => Promise<void>;
    /** Response creation helper to maintain consistency. */
    response_create: (
        message: string, 
        actions: CalypsoAction[], 
        success: boolean, 
        statusCode: CalypsoStatusCode,
        ui_hints?: any
    ) => CalypsoResponse;
    /** Internal key registration helper. */
    key_register: (provider: string, key: string) => CalypsoResponse;
}

/**
 * Signature for a system command handler.
 */
export type SystemCommandHandler = (args: string[], context: SystemCommandContext) => Promise<CalypsoResponse>;

/**
 * Orchestrator for registering and dispatching OS-level system commands.
 */
export class SystemCommandRegistry {
    private readonly handlers: Map<string, SystemCommandHandler> = new Map();

    /**
     * Register a new system command handler.
     *
     * @param name - The command verb (e.g., 'reset', 'snapshot').
     * @param handler - The function to execute.
     */
    public register(name: string, handler: SystemCommandHandler): void {
        this.handlers.set(name.toLowerCase(), handler);
    }

    /**
     * Dispatch a command to its registered handler.
     *
     * @param name - Command verb.
     * @param args - Command arguments.
     * @param context - Execution context.
     * @returns The handler's response, or null if command is not registered.
     */
    public async execute(
        name: string, 
        args: string[], 
        context: SystemCommandContext
    ): Promise<CalypsoResponse | null> {
        const handler = this.handlers.get(name.toLowerCase());
        if (!handler) {
            return null;
        }
        return await handler(args, context);
    }

    /**
     * List all registered command verbs.
     */
    public commands_list(): string[] {
        return Array.from(this.handlers.keys()).sort();
    }
}

/**
 * Factory to populate a registry with the standard ARGUS system handlers.
 */
export function register_defaultHandlers(registry: SystemCommandRegistry): void {
    // /snapshot [path]
    registry.register('snapshot', async (args, ctx) => {
        const snap: VfsSnapshotNode | null = vfs_snapshot(ctx.vfs, args[0] || '/', true);
        return snap 
            ? ctx.response_create(JSON.stringify(snap, null, 2), [], true, CalypsoStatusCode.OK) 
            : ctx.response_create(`Path not found: ${args[0]}`, [], false, CalypsoStatusCode.ERROR);
    });

    // /state
    registry.register('state', async (_args, ctx) => {
        return ctx.response_create(JSON.stringify(ctx.storeActions.state_get(), null, 2), [], true, CalypsoStatusCode.OK);
    });

    // /reset
    registry.register('reset', async (_args, ctx) => {
        ctx.vfs.reset();
        ctx.storeActions.reset();
        await ctx.session_realign();
        try {
            ctx.vfs.dir_create(ctx.sessionPath);
        } catch { /* ignore */ }
        await ctx.workflowSession.sync(); 
        ctx.merkleEngine.session_setPath(ctx.sessionPath);
        return ctx.response_create('System reset to clean state.', [], true, CalypsoStatusCode.OK);
    });

    // /version
    registry.register('version', async (_args, ctx) => {
        return ctx.response_create(ctx.statusProvider.version_get(), [], true, CalypsoStatusCode.OK);
    });

    // /status
    registry.register('status', async (_args, ctx) => {
        const msg = ctx.statusProvider.status_generate(ctx.engineAvailable, ctx.activeProvider, ctx.activeModel);
        return ctx.response_create(msg, [], true, CalypsoStatusCode.OK);
    });

    // /key <provider> <key>
    registry.register('key', async (args, ctx) => {
        return ctx.key_register(args[0], args[1]);
    });

    // /workflows
    registry.register('workflows', async (_args, ctx) => {
        const workflows: WorkflowSummary[] = WorkflowAdapter.workflows_summarize();
        const list: string = workflows.map((w): string => `○ [${w.id}] ${w.name}: ${w.description}`).join('\n');
        return ctx.response_create(list, [], true, CalypsoStatusCode.OK);
    });

    // /session [list|new|resume <id>]
    registry.register('session', async (args, ctx) => {
        const sub: string = (args[0] || 'list').toLowerCase();
        const username: string = ctx.username_resolve();
        const persona: string = ctx.shell.env_get('PERSONA') || 'fedml';
        const personaRoot = `/home/${username}/projects/${persona}`;

        switch (sub) {
            case 'list': {
                try {
                    const sessions = ctx.vfs.dir_list(personaRoot).filter(e => e.type === 'folder');
                    const currentId = ctx.storeActions.sessionId_get();
                    const list = sessions.map(s => `○ ${s.name}${s.name === currentId ? ' [ACTIVE]' : ''}`).join('\n');
                    return ctx.response_create(`AVAILABLE SESSIONS [${persona.toUpperCase()}]:\n${list || 'None'}`, [], true, CalypsoStatusCode.OK);
                } catch { return ctx.response_create(`No sessions found for persona: ${persona}`, [], false, CalypsoStatusCode.ERROR); }
            }
            case 'new': {
                ctx.storeActions.state_set({ activeProject: null } as any);
                ctx.storeActions.session_start();
                const { sessionDir_scaffold } = await import('../../vfs/providers/ProjectProvider.js');
                sessionDir_scaffold(ctx.vfs, username);
                await ctx.session_realign();
                await ctx.workflowSession.sync();
                return ctx.response_create(`● STARTED NEW SESSION: [${ctx.storeActions.sessionId_get()}]`, [], true, CalypsoStatusCode.OK);
            }
            case 'resume': {
                const targetId = args[1];
                if (!targetId) return ctx.response_create('Usage: /session resume <id>', [], false, CalypsoStatusCode.ERROR);
                if (!ctx.vfs.node_stat(`${personaRoot}/${targetId}`)) return ctx.response_create(`Session not found: ${targetId}`, [], false, CalypsoStatusCode.ERROR);
                ctx.storeActions.state_set({ currentSessionId: targetId } as any);
                await ctx.session_realign();
                await ctx.workflowSession.sync();
                return ctx.response_create(`● RESUMED SESSION: [${targetId}]`, [], true, CalypsoStatusCode.OK);
            }
            default: return ctx.response_create('Usage: /session [list|new|resume <id>]', [], false, CalypsoStatusCode.ERROR);
        }
    });

    // /settings [show|set|unset]
    registry.register('settings', async (args, ctx) => {
        const sub: string = (args[0] || 'show').toLowerCase();
        const username: string = ctx.username_resolve();
        const usage: string = 'Usage: /settings [show|set convo_width <n>|unset convo_width]';

        if (sub === 'show') {
            const userSettings = ctx.settingsService.userSettings_get(username);
            const resolved = ctx.settingsService.snapshot(username);
            const source = ctx.settingsService.convoWidth_source(username);
            const userValue = userSettings.convo_width;
            const userSegment = typeof userValue === 'number' ? `${userValue}` : 'unset';
            const lines: string[] = [
                `SETTINGS [${username}]:`,
                `  convo_width = ${resolved.convo_width} (source: ${source}, user: ${userSegment})`,
            ];
            return ctx.response_create(lines.join('\n'), [], true, CalypsoStatusCode.OK);
        }

        if (sub === 'set') {
            const key = args[1];
            const value = args[2];
            if (!key || value === undefined) {
                return ctx.response_create(usage, [], false, CalypsoStatusCode.ERROR);
            }
            if (key !== 'convo_width') {
                return ctx.response_create(`Unknown setting key: ${key}`, [], false, CalypsoStatusCode.ERROR);
            }
            const result = ctx.settingsService.set(username, 'convo_width', value);
            if (!result.ok) {
                return ctx.response_create(result.error, [], false, CalypsoStatusCode.ERROR);
            }
            return ctx.response_create(`● SET convo_width=${result.value} for user ${username}`, [], true, CalypsoStatusCode.OK);
        }

        if (sub === 'unset') {
            const key = args[1];
            if (!key) {
                return ctx.response_create(usage, [], false, CalypsoStatusCode.ERROR);
            }
            if (key !== 'convo_width') {
                return ctx.response_create(`Unknown setting key: ${key}`, [], false, CalypsoStatusCode.ERROR);
            }
            ctx.settingsService.unset(username, 'convo_width');
            return ctx.response_create(`● UNSET convo_width for user ${username}`, [], true, CalypsoStatusCode.OK);
        }

        if (sub === 'help') {
            return ctx.response_create(usage, [], true, CalypsoStatusCode.OK);
        }

        return ctx.response_create(usage, [], false, CalypsoStatusCode.ERROR);
    });

    // /dag show [...]
    registry.register('dag', async (args, ctx) => {
        const usage: string = [
            'Usage: /dag show [--full] [--where] [--stale] [--compact] [--box] [--no-optional] [--manifest <id>]',
            'Aliases: dag show, dag, "show workflow", "show dag", "where am i in the workflow"',
        ].join('\n');

        if (args.length > 0 && (args[0] === 'help' || args[0] === '--help' || args[0] === '-h')) {
            return ctx.response_create(usage, [], true, CalypsoStatusCode.OK);
        }

        const parseResult = dagOptions_parse(args);
        if (!parseResult.ok || !parseResult.options) {
            return ctx.response_create(parseResult.error || usage, [], false, CalypsoStatusCode.ERROR);
        }

        const options: DagCommandOptions = parseResult.options;
        let adapter: WorkflowAdapter = ctx.workflowAdapter;
        if (options.manifestId && options.manifestId !== ctx.workflowAdapter.workflowId) {
            try {
                adapter = WorkflowAdapter.definition_load(options.manifestId);
            } catch {
                return ctx.response_create(`Unknown workflow/manifest: ${options.manifestId}`, [], false, CalypsoStatusCode.ERROR);
            }
        }

        const renderOptions: DagRenderOptions = {
            includeStructural: options.includeStructural,
            includeOptional: options.includeOptional,
            compact: options.compact,
            box: options.box,
            showWhere: options.showWhere,
            showStale: options.showStale,
        };

        const visualization: string = adapter.dag_render(ctx.vfs, ctx.sessionPath, renderOptions);
        return ctx.response_create(visualization, [], true, CalypsoStatusCode.OK);
    });

    // /help
    registry.register('help', async (_args, ctx) => {
        const verbs = registry.commands_list().map(v => `/${v}`).join(', ');
        return ctx.response_create(`SYSTEM COMMANDS:\n  ${verbs}\n\nType a command or ask a question.`, [], true, CalypsoStatusCode.OK);
    });
}

/**
 * Internal parser for DAG rendering options.
 */
function dagOptions_parse(args: string[]): { ok: boolean; options?: DagCommandOptions; error?: string } {
    const remaining: string[] = [...args];

    const firstNonFlag: string | undefined = remaining.find((token: string): boolean => !token.startsWith('-'));
    if (firstNonFlag && firstNonFlag.toLowerCase() !== 'show') {
        return { ok: false, error: `Unknown dag action: ${firstNonFlag}. Supported: show` };
    }

    const options: DagCommandOptions = {
        includeStructural: true,
        includeOptional: true,
        compact: false,
        box: false,
        showWhere: true,
        showStale: false,
        manifestId: null,
    };

    for (let i = 0; i < remaining.length; i++) {
        const token: string = remaining[i].toLowerCase();
        if (token === 'show') continue;
        if (token === '--full') {
            options.includeStructural = true;
            continue;
        }
        if (token === '--where') {
            options.showWhere = true;
            continue;
        }
        if (token === '--stale') {
            options.showStale = true;
            continue;
        }
        if (token === '--compact') {
            options.compact = true;
            continue;
        }
        if (token === '--box') {
            options.box = true;
            continue;
        }
        if (token === '--no-optional') {
            options.includeOptional = false;
            continue;
        }
        if (token === '--optional') {
            options.includeOptional = true;
            continue;
        }
        if (token === '--manifest' || token === '--workflow') {
            const next: string | undefined = remaining[i + 1];
            if (!next) {
                return { ok: false, error: `${token} requires a workflow id` };
            }
            options.manifestId = next.trim();
            i += 1;
            continue;
        }
        if (token.startsWith('-')) {
            return { ok: false, error: `Unknown dag flag: ${remaining[i]}` };
        }
    }

    return { ok: true, options };
}
