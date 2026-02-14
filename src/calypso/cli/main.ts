#!/usr/bin/env npx tsx
/**
 * @file Calypso CLI Entry Point
 *
 * Thin entry point that parses CLI arguments and starts the
 * WebSocket-based REPL.
 *
 * Usage:
 *   npx tsx src/calypso/cli/main.ts
 *   npx tsx src/calypso/cli/main.ts --port 9090
 *   npx tsx src/calypso/cli/main.ts --url ws://remote:8081/calypso/ws
 *
 * @module
 */

import { repl_start } from './Repl.js';

// Parse simple CLI arguments
const args = process.argv.slice(2);
const options: { host?: string; port?: number; url?: string } = {};

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host' && args[i + 1]) {
        options.host = args[++i];
    } else if (args[i] === '--port' && args[i + 1]) {
        options.port = parseInt(args[++i], 10);
    } else if (args[i] === '--url' && args[i + 1]) {
        options.url = args[++i];
    }
}

repl_start(options).catch((e: Error) => {
    console.error(`Fatal error: ${e.message}`);
    process.exit(1);
});
