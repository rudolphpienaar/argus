#!/usr/bin/env npx tsx
/**
 * @file Calypso Headless Server
 *
 * Entry point for the Calypso server. Delegates to CalypsoServer
 * which provides both REST API and WebSocket endpoints.
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

import { calypsoServer_start } from '../calypso/server/CalypsoServer.js';

calypsoServer_start();
