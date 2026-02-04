#!/usr/bin/env npx tsx
/**
 * @file Calypso Headless Server
 *
 * Runs CalypsoCore as a standalone Node.js server without a browser.
 * Exposes REST API for command execution and state inspection.
 *
 * Usage:
 *   npx ts-node src/cli/calypso-server.ts
 *   # or
 *   make calypso
 *
 * @module
 * @see docs/calypso.adoc
 * @see docs/oracle.adoc
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import { CalypsoCore, type CalypsoStoreActions } from '../lcarslm/CalypsoCore.js';
import { VirtualFileSystem } from '../vfs/VirtualFileSystem.js';
import { Shell } from '../vfs/Shell.js';
import { homeDir_scaffold } from '../vfs/providers/ProjectProvider.js';
import type { CalypsoResponse } from '../lcarslm/types.js';
import type { Dataset, AppState } from '../core/models/types.js';
import { DATASETS } from '../core/data/datasets.js';
import { VERSION, GIT_HASH } from '../generated/version.js';

// ─── Environment Loading ───────────────────────────────────────────────────

/**
 * Simple .env loader to avoid dependencies.
 * Loads GEMINI_API_KEY or OPENAI_API_KEY from .env file in CWD.
 */
function env_load(): void {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
        console.log('Loading configuration from .env');
        const content = fs.readFileSync(envPath, 'utf-8');
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const [key, ...valParts] = trimmed.split('=');
                const val = valParts.join('=').trim().replace(/^["']|["']$/g, ''); // strip quotes
                if (!process.env[key.trim()]) {
                    process.env[key.trim()] = val;
                }
            }
        });
    }
}

// Load env before configuration
env_load();

// ─── Configuration ─────────────────────────────────────────────────────────

const PORT: number = parseInt(process.env.CALYPSO_PORT || '8081', 10);
const HOST: string = process.env.CALYPSO_HOST || 'localhost';

// ─── Headless Store Implementation ─────────────────────────────────────────

/**
 * Minimal store implementation for headless mode.
 * Holds state in memory without EventBus dependencies.
 */
class HeadlessStore implements CalypsoStoreActions {
    private _state: {
        currentStage: AppState['currentStage'];
        selectedDatasets: Dataset[];
        activeProject: { id: string; name: string } | null;
        marketplaceOpen: boolean;
        installedAssets: string[];
    };

    constructor() {
        this._state = {
            currentStage: 'search',
            selectedDatasets: [],
            activeProject: null,
            marketplaceOpen: false,
            installedAssets: []
        };
    }

    public state_get(): Partial<AppState> {
        return {
            currentStage: this._state.currentStage,
            selectedDatasets: [...this._state.selectedDatasets],
            activeProject: this._state.activeProject as AppState['activeProject'],
            marketplaceOpen: this._state.marketplaceOpen,
            installedAssets: [...this._state.installedAssets]
        };
    }

    public reset(): void {
        this._state.currentStage = 'search';
        this._state.selectedDatasets = [];
        this._state.activeProject = null;
    }

    public dataset_select(dataset: Dataset): void {
        if (!this._state.selectedDatasets.some(ds => ds.id === dataset.id)) {
            this._state.selectedDatasets.push(dataset);
        }
    }

    public dataset_deselect(id: string): void {
        this._state.selectedDatasets = this._state.selectedDatasets.filter(ds => ds.id !== id);
    }

    public datasets_getSelected(): Dataset[] {
        return this._state.selectedDatasets;
    }

    public project_getActive(): { id: string; name: string } | null {
        return this._state.activeProject;
    }

    public stage_set(stage: AppState['currentStage']): void {
        this._state.currentStage = stage;
    }
}

// ─── Server Setup ──────────────────────────────────────────────────────────

/**
 * Initialize CalypsoCore with headless dependencies.
 */
function calypso_initialize(): CalypsoCore {
    const vfs = new VirtualFileSystem();
    const store = new HeadlessStore();
    const shell = new Shell(vfs);

    // Scaffold home directory
    homeDir_scaffold(vfs);

    // Initialize shell
    shell.env_set('USER', 'developer');
    shell.env_set('HOME', '/home/developer');
    shell.env_set('STAGE', 'search');
    shell.env_set('PERSONA', 'fedml');

    // Check for API keys - enable real LLM if available
    let openaiKey = process.env.OPENAI_API_KEY;
    let geminiKey = process.env.GEMINI_API_KEY;

    // Handle case where Makefile sets both to the same value
    if (openaiKey && openaiKey === geminiKey) {
        if (openaiKey.startsWith('sk-')) {
            geminiKey = undefined; // It's OpenAI
        } else if (openaiKey.startsWith('AIza')) {
            openaiKey = undefined; // It's Gemini
        }
    }

    const hasApiKey = !!(openaiKey || geminiKey);

    if (hasApiKey) {
        console.log(`AI Core: ${openaiKey ? 'OpenAI' : 'Gemini'} API key detected`);
    } else {
        console.log('AI Core: No API key found (simulation mode)');
        console.log('  Set OPENAI_API_KEY or GEMINI_API_KEY via environment or .env file');
    }

    const core = new CalypsoCore(vfs, shell, store, {
        simulationMode: !hasApiKey,
        llmConfig: hasApiKey ? {
            provider: openaiKey ? 'openai' : 'gemini',
            apiKey: (openaiKey || geminiKey) as string,
            model: openaiKey ? 'gpt-4o-mini' : 'gemini-flash-latest'
        } : undefined
    });

    return core;
}

// Global CalypsoCore instance
let calypso: CalypsoCore = calypso_initialize();

/**
 * Parse JSON body from request.
 */
async function body_parse(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * Send JSON response.
 */
function json_send(res: http.ServerResponse, data: unknown, status: number = 200): void {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data, null, 2));
}

/**
 * Handle API requests.
 */
async function request_handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    // CORS preflight
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    try {
        // POST /calypso/command - Execute a command
        if (path === '/calypso/command' && method === 'POST') {
            const body = await body_parse(req);
            const command = body.command as string;

            if (!command) {
                json_send(res, { error: 'Missing "command" field' }, 400);
                return;
            }

            const response: CalypsoResponse = await calypso.command_execute(command);
            json_send(res, response);
            return;
        }

        // GET /calypso/vfs/snapshot - Get VFS snapshot
        if (path === '/calypso/vfs/snapshot' && method === 'GET') {
            const rootPath = url.searchParams.get('path') || '/';
            const includeContent = url.searchParams.get('content') === 'true';
            const snapshot = calypso.vfs_snapshot(rootPath, includeContent);
            json_send(res, { snapshot });
            return;
        }

        // GET /calypso/vfs/exists - Check if path exists
        if (path === '/calypso/vfs/exists' && method === 'GET') {
            const checkPath = url.searchParams.get('path');
            if (!checkPath) {
                json_send(res, { error: 'Missing "path" parameter' }, 400);
                return;
            }
            const exists = calypso.vfs_exists(checkPath);
            json_send(res, { exists, path: checkPath });
            return;
        }

        // GET /calypso/vfs/read - Read file content
        if (path === '/calypso/vfs/read' && method === 'GET') {
            const readPath = url.searchParams.get('path');
            if (!readPath) {
                json_send(res, { error: 'Missing "path" parameter' }, 400);
                return;
            }
            const content = calypso.vfs_read(readPath);
            json_send(res, { content, path: readPath });
            return;
        }

        // GET /calypso/store/state - Get store state
        if (path === '/calypso/store/state' && method === 'GET') {
            const state = calypso.store_snapshot();
            json_send(res, { state });
            return;
        }

        // GET /calypso/store/get - Get specific store property
        if (path === '/calypso/store/get' && method === 'GET') {
            const property = url.searchParams.get('property');
            if (!property) {
                json_send(res, { error: 'Missing "property" parameter' }, 400);
                return;
            }
            const state = calypso.store_snapshot();
            const value = (state as Record<string, unknown>)[property];
            json_send(res, { property, value });
            return;
        }

        // POST /calypso/reset - Reset system
        if (path === '/calypso/reset' && method === 'POST') {
            calypso = calypso_initialize();
            json_send(res, { message: 'System reset to clean state' });
            return;
        }

        // GET /calypso/version - Get version
        if (path === '/calypso/version' && method === 'GET') {
            json_send(res, { version: calypso.version_get() });
            return;
        }

        // GET / - Health check
        if (path === '/' && method === 'GET') {
            json_send(res, {
                service: 'Calypso Server',
                version: calypso.version_get(),
                status: 'running',
                endpoints: [
                    'POST /calypso/command',
                    'GET  /calypso/vfs/snapshot',
                    'GET  /calypso/vfs/exists',
                    'GET  /calypso/vfs/read',
                    'GET  /calypso/store/state',
                    'GET  /calypso/store/get',
                    'POST /calypso/reset',
                    'GET  /calypso/version'
                ]
            });
            return;
        }

        // 404 for unknown routes
        json_send(res, { error: 'Not found', path }, 404);

    } catch (e) {
        const error = e instanceof Error ? e.message : 'Unknown error';
        json_send(res, { error }, 500);
    }
}

// ─── Main ──────────────────────────────────────────────────────────────────

const server = http.createServer(request_handle);

server.listen(PORT, HOST, () => {
    const vString = `V${VERSION}-${GIT_HASH}`;
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  CALYPSO SERVER ${vString}${' '.repeat(44 - vString.length)}║
╚══════════════════════════════════════════════════════════════╝

Listening on http://${HOST}:${PORT}

Endpoints:
  POST /calypso/command      - Execute a command
  GET  /calypso/vfs/snapshot - Get VFS tree snapshot
  GET  /calypso/vfs/exists   - Check if path exists
  GET  /calypso/vfs/read     - Read file content
  GET  /calypso/store/state  - Get store state
  POST /calypso/reset        - Reset to clean state

Press Ctrl+C to stop.
`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close(() => {
        console.log('Goodbye.');
        process.exit(0);
    });
});
