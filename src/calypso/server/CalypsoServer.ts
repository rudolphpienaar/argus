/**
 * @file Calypso Server
 *
 * Combined HTTP + WebSocket server for CalypsoCore. Serves REST API
 * for backward compatibility and WebSocket connections for shared
 * sessions between TUI and Web UI clients.
 *
 * @module
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import type { Socket } from 'net';
import { WebSocketServer, type WebSocket } from 'ws';
import { CalypsoCore } from '../../lcarslm/CalypsoCore.js';
import type { CalypsoStoreActions } from '../../lcarslm/types.js';
import type { Dataset, AppState, Project } from '../../core/models/types.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { Shell } from '../../vfs/Shell.js';
import { ContentRegistry } from '../../vfs/content/ContentRegistry.js';
import { ALL_GENERATORS } from '../../vfs/content/templates/index.js';
import { homeDir_scaffold } from '../../vfs/providers/ProjectProvider.js';
import { VERSION } from '../../generated/version.js';
import { store } from '../../core/state/store.js';
import { DATASETS } from '../../core/data/datasets.js';
import { SYSTEM_KNOWLEDGE } from '../../core/data/knowledge.js';
import { restRequest_handle } from './RestHandler.js';
import { wsConnection_handle } from './WebSocketHandler.js';
import type { RestHandlerDeps } from './rest/types.js';

// ─── Environment Loading ────────────────────────────────────────────────────

/**
 * Simple .env loader to avoid dependencies.
 */
function env_load(): void {
    const envPath: string = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        console.log('Loading configuration from .env');
        const content: string = fs.readFileSync(envPath, 'utf-8');
        content.split('\n').forEach((line: string): void => {
            const trimmed: string = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const splitLine: string[] = trimmed.split('=');
                const key: string = splitLine[0];
                const valParts: string[] = splitLine.slice(1);
                const val: string = valParts.join('=').trim().replace(/^["']|["']$/g, '');
                if (!process.env[key.trim()]) {
                    process.env[key.trim()] = val;
                }
            }
        });
    }
}

interface ServerRuntimeConfig {
    host: string;
    port: number;
}

/**
 * Resolve runtime server configuration after environment hydration.
 *
 * @param options - User-supplied server options.
 * @returns Resolved host/port config.
 */
function serverConfig_resolve(options: CalypsoServerOptions): ServerRuntimeConfig {
    env_load();

    const host: string = options.host || process.env.CALYPSO_HOST || 'localhost';
    const port: number = port_resolve(options.port, process.env.CALYPSO_PORT);
    return { host, port };
}

/**
 * Resolve and validate server port.
 *
 * @param optionPort - Explicit option override.
 * @param envPort - Environment provided port string.
 * @returns Safe port number.
 */
function port_resolve(optionPort: number | undefined, envPort: string | undefined): number {
    if (optionPort !== undefined) {
        if (port_isValid(optionPort)) {
            return optionPort;
        }
        console.warn(`Invalid CALYPSO port option "${optionPort}". Falling back to 8081.`);
        return 8081;
    }

    const parsedPort: number = Number.parseInt(envPort || '8081', 10);
    if (port_isValid(parsedPort)) {
        return parsedPort;
    }

    if (envPort) {
        console.warn(`Invalid CALYPSO_PORT value "${envPort}". Falling back to 8081.`);
    }
    return 8081;
}

/**
 * Validate TCP port range.
 *
 * @param port - Port number to validate.
 * @returns True if port is valid.
 */
function port_isValid(port: number): boolean {
    return Number.isInteger(port) && port > 0 && port <= 65535;
}

// ─── Global Store Adapter ───────────────────────────────────────────────────

class GlobalStoreAdapter implements CalypsoStoreActions {
    private sessionPath: string | null = null;

    public session_setPath(path: string): void {
        this.sessionPath = path;
    }

    public state_get(): Partial<AppState> {
        return {
            currentPersona: store.state.currentPersona,
            currentSessionId: store.state.currentSessionId,
            currentStage: store.state.currentStage,
            selectedDatasets: [...store.state.selectedDatasets],
            activeProject: store.state.activeProject,
            marketplaceOpen: store.state.marketplaceOpen,
            installedAssets: [...store.state.installedAssets],
            lastIntent: store.state.lastIntent
        };
    }

    public state_set(state: Partial<AppState>): void {
        store.state_patch(state);
    }

    public session_start(): void {
        store.session_start();
    }

    public reset(): void {
        store.selection_clear();
        store.project_unload();
        store.stage_set('search');
    }

    public dataset_select(dataset: Dataset): void {
        store.dataset_select(dataset);
    }

    public dataset_deselect(id: string): void {
        store.dataset_deselect(id);
    }

    public dataset_getById(id: string): Dataset | undefined {
        return DATASETS.find(ds => ds.id === id);
    }

    public datasets_getSelected(): Dataset[] {
        return store.state.selectedDatasets;
    }

    public project_getActive(): { id: string; name: string } | null {
        return store.state.activeProject;
    }

    public project_getActiveFull(): Project | null {
        return store.state.activeProject;
    }

    public project_setActive(project: Project): void {
        store.project_load(project);
    }

    public stage_set(stage: AppState['currentStage']): void {
        store.stage_set(stage);
    }

    public session_getPath(): string | null {
        return this.sessionPath;
    }

    public sessionId_get(): string | null {
        return store.sessionId_get();
    }

    public lastMentioned_set(datasets: Dataset[]): void {
        store.lastMentioned_set(datasets);
    }

    public lastMentioned_get(): Dataset[] {
        return store.lastMentioned_get();
    }
}

// ─── CalypsoCore Initialization ─────────────────────────────────────────────

/**
 * Initialize CalypsoCore with headless dependencies.
 */
function calypso_initialize(username: string = 'developer'): CalypsoCore {
    const vfs: VirtualFileSystem = new VirtualFileSystem(username);
    store.globalVcs_set(vfs);

    const registry: ContentRegistry = new ContentRegistry();
    registry.generators_registerAll(ALL_GENERATORS);
    registry.vfs_connect(vfs);

    const shell: Shell = new Shell(vfs, username);
    store.globalShell_set(shell);

    const storeAdapter: GlobalStoreAdapter = new GlobalStoreAdapter();
    homeDir_scaffold(vfs, username);

    shell.env_set('USER', username);
    shell.env_set('HOME', `/home/${username}`);
    shell.env_set('STAGE', 'search');
    shell.env_set('PERSONA', 'fedml');
    shell.env_set('PS1', '$USER@CALYPSO:[$PWD]> ');

    let openaiKey: string | undefined = process.env.OPENAI_API_KEY;
    let geminiKey: string | undefined = process.env.GEMINI_API_KEY;

    if (openaiKey && openaiKey === geminiKey) {
        if (openaiKey.startsWith('sk-')) {
            geminiKey = undefined;
        } else if (openaiKey.startsWith('AIza')) {
            openaiKey = undefined;
        }
    }

    const hasApiKey: boolean = Boolean(openaiKey || geminiKey);

    if (hasApiKey) {
        console.log(`AI Core: ${openaiKey ? 'OpenAI' : 'Gemini'} API key detected`);
    } else {
        console.log('AI Core: No API key found (offline mode)');
        console.log('  Set OPENAI_API_KEY or GEMINI_API_KEY via environment or .env file');
    }

    const core: CalypsoCore = new CalypsoCore(vfs, shell, storeAdapter, {
        llmConfig: hasApiKey ? {
            provider: openaiKey ? 'openai' : 'gemini',
            apiKey: (openaiKey || geminiKey) as string,
            model: openaiKey ? 'gpt-4o-mini' : 'gemini-flash-latest'
        } : undefined,
        knowledge: SYSTEM_KNOWLEDGE
    });

    storeAdapter.session_setPath(core.session_getPath());
    return core;
}

// ─── Server ─────────────────────────────────────────────────────────────────

export interface CalypsoServerOptions {
    host?: string;
    port?: number;
}

/**
 * Create and start a Calypso server with REST + WebSocket support.
 */
export function calypsoServer_start(options: CalypsoServerOptions = {}): http.Server {
    const config: ServerRuntimeConfig = serverConfig_resolve(options);
    const host: string = config.host;
    const port: number = config.port;

    let calypso: CalypsoCore = calypso_initialize();

    const deps: RestHandlerDeps = {
        calypso_get: () => calypso,
        calypso_reinitialize: (username?: string): CalypsoCore => {
            calypso = calypso_initialize(username);
            return calypso;
        },
        host,
        port
    };

    // HTTP server with REST handler
    const server: http.Server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        const handled: boolean = await restRequest_handle(req, res, deps);
        if (!handled) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found', path: req.url }));
        }
    });

    // WebSocket server on /calypso/ws path
    const wss: WebSocketServer = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req: http.IncomingMessage, socket: Socket, head: Buffer): void => {
        const url: URL = new URL(req.url || '/', `http://${host}:${port}`);
        if (url.pathname === '/calypso/ws') {
            // Disable Nagle's algorithm so each WebSocket frame is flushed as
            // its own TCP segment. Without this, consecutive small frames
            // (e.g. boot_log WAIT followed by OK) can be coalesced by the
            // kernel and arrive at the client in a single data event, causing
            // both to be processed synchronously and the WAIT state to never
            // render before being overwritten by OK.
            socket.setNoDelay(true);
            wss.handleUpgrade(req, socket, head, (ws: WebSocket): void => {
                wss.emit('connection', ws, req);
            });
        } else {
            socket.destroy();
        }
    });

    wss.on('connection', (ws: WebSocket): void => {
        console.log(`WebSocket client connected (total: ${wss.clients.size})`);
        wsConnection_handle(ws, deps);

        ws.on('close', () => {
            console.log(`WebSocket client disconnected (total: ${wss.clients.size})`);
        });
    });

    // Start listening
    server.listen(port, host, (): void => {
        const vString: string = `V${VERSION}`;
        const innerWidth: number = 64;

        const line_format: (text: string) => string = (text: string): string => {
            const label: string = `  ${text}`;
            const padding: string = ' '.repeat(Math.max(0, innerWidth - label.length));
            return `║${label}${padding}║`;
        };

        console.log(`
╔${'═'.repeat(innerWidth)}╗
${line_format(`CALYPSO SERVER ${vString}`)}
╚${'═'.repeat(innerWidth)}╝

Listening on http://${host}:${port}
WebSocket:   ws://${host}:${port}/calypso/ws

Endpoints:
  POST /calypso/command      - Execute a command
  POST /calypso/login        - Login with username
  POST /calypso/persona      - Set workflow persona
  GET  /calypso/vfs/snapshot - Get VFS tree snapshot
  GET  /calypso/vfs/exists   - Check if path exists
  GET  /calypso/vfs/read     - Read file content
  GET  /calypso/store/state  - Get store state
  GET  /calypso/prompt       - Get current CLI prompt
  POST /calypso/reset        - Reset to clean state
  GET  /calypso/workflows    - List available workflows
  WS   /calypso/ws           - WebSocket endpoint

Press Ctrl+C to stop.
`);
    });

    process.on('SIGINT', () => {
        console.log('\nShutting down...');
        wss.close();
        server.close(() => {
            console.log('Goodbye.');
            process.exit(0);
        });
    });

    return server;
}
