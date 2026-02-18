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
import { WebSocketServer } from 'ws';
import { CalypsoCore } from '../../lcarslm/CalypsoCore.js';
import type { CalypsoStoreActions } from '../../lcarslm/types.js';
import type { Dataset, AppState, FederationState } from '../../core/models/types.js';
import { VirtualFileSystem } from '../../vfs/VirtualFileSystem.js';
import { Shell } from '../../vfs/Shell.js';
import { ContentRegistry } from '../../vfs/content/ContentRegistry.js';
import { ALL_GENERATORS } from '../../vfs/content/templates/index.js';
import { homeDir_scaffold } from '../../vfs/providers/ProjectProvider.js';
import { VERSION } from '../../generated/version.js';
import { store, globals } from '../../core/state/store.js';
import { restRequest_handle } from './RestHandler.js';
import { wsConnection_handle } from './WebSocketHandler.js';

// ─── Environment Loading ────────────────────────────────────────────────────

/**
 * Simple .env loader to avoid dependencies.
 */
function env_load(): void {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        console.log('Loading configuration from .env');
        const content = fs.readFileSync(envPath, 'utf-8');
        content.split('\n').forEach((line: string): void => {
            const trimmed: string = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const [key, ...valParts] = trimmed.split('=');
                const val = valParts.join('=').trim().replace(/^["']|["']$/g, '');
                if (!process.env[key.trim()]) {
                    process.env[key.trim()] = val;
                }
            }
        });
    }
}

// ─── Global Store Adapter ───────────────────────────────────────────────────

class GlobalStoreAdapter implements CalypsoStoreActions {
    private sessionPath: string | null = null;

    public session_setPath(path: string): void {
        this.sessionPath = path;
    }

    public state_get(): Partial<AppState> {
        return {
            currentStage: store.state.currentStage,
            selectedDatasets: [...store.state.selectedDatasets],
            activeProject: store.state.activeProject,
            marketplaceOpen: store.state.marketplaceOpen,
            installedAssets: [...store.state.installedAssets],
            lastIntent: store.state.lastIntent
        };
    }

    public state_set(state: Partial<AppState>): void {
        Object.assign(store.state, state);
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

    public datasets_getSelected(): Dataset[] {
        return store.state.selectedDatasets;
    }

    public project_getActive(): { id: string; name: string } | null {
        return store.state.activeProject;
    }

    public stage_set(stage: AppState['currentStage']): void {
        store.stage_set(stage);
    }

    public session_getPath(): string | null {
        return this.sessionPath;
    }

    public federation_getState(): FederationState | null {
        return store.state.federationState;
    }

    public federation_setState(state: FederationState | null): void {
        store.state.federationState = state;
    }
}

// ─── CalypsoCore Initialization ─────────────────────────────────────────────

/**
 * Initialize CalypsoCore with headless dependencies.
 */
function calypso_initialize(username: string = 'developer'): CalypsoCore {
    const vfs = new VirtualFileSystem(username);
    globals.vcs = vfs;

    const registry = new ContentRegistry();
    registry.generators_registerAll(ALL_GENERATORS);
    registry.vfs_connect(vfs);

    const shell = new Shell(vfs, username);
    globals.shell = shell;

    const storeAdapter = new GlobalStoreAdapter();
    homeDir_scaffold(vfs, username);

    shell.env_set('USER', username);
    shell.env_set('HOME', `/home/${username}`);
    shell.env_set('STAGE', 'search');
    shell.env_set('PERSONA', 'fedml');
    shell.env_set('PS1', '$USER@CALYPSO:[$PWD]> ');

    let openaiKey = process.env.OPENAI_API_KEY;
    let geminiKey = process.env.GEMINI_API_KEY;

    if (openaiKey && openaiKey === geminiKey) {
        if (openaiKey.startsWith('sk-')) {
            geminiKey = undefined;
        } else if (openaiKey.startsWith('AIza')) {
            openaiKey = undefined;
        }
    }

    const hasApiKey = !!(openaiKey || geminiKey);

    if (hasApiKey) {
        console.log(`AI Core: ${openaiKey ? 'OpenAI' : 'Gemini'} API key detected`);
    } else {
        console.log('AI Core: No API key found (simulation mode)');
        console.log('  Set OPENAI_API_KEY or GEMINI_API_KEY via environment or .env file');
    }

    const core = new CalypsoCore(vfs, shell, storeAdapter, {
        simulationMode: !hasApiKey,
        llmConfig: hasApiKey ? {
            provider: openaiKey ? 'openai' : 'gemini',
            apiKey: (openaiKey || geminiKey) as string,
            model: openaiKey ? 'gpt-4o-mini' : 'gemini-flash-latest'
        } : undefined
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
    const host: string = options.host || process.env.CALYPSO_HOST || 'localhost';
    const port: number = options.port || parseInt(process.env.CALYPSO_PORT || '8081', 10);

    env_load();

    let calypso: CalypsoCore = calypso_initialize();

    const deps = {
        calypso_get: () => calypso,
        calypso_reinitialize: (username?: string): CalypsoCore => {
            calypso = calypso_initialize(username);
            return calypso;
        },
        host,
        port
    };

    // HTTP server with REST handler
    const server = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
        const handled = await restRequest_handle(req, res, deps);
        if (!handled) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found', path: req.url }));
        }
    });

    // WebSocket server on /calypso/ws path
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', `http://${host}:${port}`);
        if (url.pathname === '/calypso/ws') {
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        } else {
            socket.destroy();
        }
    });

    wss.on('connection', (ws) => {
        console.log(`WebSocket client connected (total: ${wss.clients.size})`);
        wsConnection_handle(ws, deps);

        ws.on('close', () => {
            console.log(`WebSocket client disconnected (total: ${wss.clients.size})`);
        });
    });

    // Start listening
    server.listen(port, host, () => {
        const vString = `V${VERSION}`;
        const innerWidth = 64;

        const line_format = (text: string): string => {
            const label = `  ${text}`;
            const padding = ' '.repeat(Math.max(0, innerWidth - label.length));
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
