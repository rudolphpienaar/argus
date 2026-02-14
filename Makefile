# ARGUS Makefile
#
# Build and manage the ARGUS UI prototype

.PHONY: help install build serve dev clean watch argus calypso calypso-cli calypso-ws test-oracle test-oracle-verbose

help:
	@echo "ARGUS Makefile"
	@echo ""
	@echo "Commands:"
	@echo "  make install      - Install npm dependencies"
	@echo "  make build        - Generate version and compile TypeScript"
	@echo "  make serve        - Start dev server on port 8080"
	@echo "  make dev          - Build and serve"
	@echo "  make watch        - Watch mode (rebuild on changes)"
	@echo "  make test         - Run unit tests"
	@echo "  make clean        - Remove build artifacts"
	@echo "  make argus        - Full cycle (clean, install, build)"
	@echo ""
	@echo "Calypso (Headless AI Core):"
	@echo "  make calypso      - Start headless Calypso server (port 8081)"
	@echo "  make calypso-cli  - Start interactive CLI client (HTTP)"
	@echo "  make calypso-ws   - Start interactive CLI client (WebSocket)"
	@echo "  make test-oracle  - Run ORACLE integration tests"
	@echo "  make test-oracle-verbose - Run ORACLE tests with verbose output"

install:
	@echo "Installing dependencies..."
	npm install

build:
	@echo "Building ARGUS..."
	npm run build

serve:
	@echo "Starting server at http://localhost:8080"
	npm run serve

dev: build serve

watch:
	@echo "Watching for changes..."
	npm run watch

test:
	@echo "Running tests..."
	npm run test

clean:
	@echo "Cleaning artifacts..."
	rm -rf dist/js node_modules src/generated package-lock.json

argus: clean install build
	@echo ""
	@echo "ARGUS is ready."
	@echo "Run 'make serve' to start the dev server."

# ─── Calypso (Headless AI Core) ─────────────────────────────────────────────

calypso:
	bash scripts/generate-version.sh
	@echo "Starting Calypso headless server..."
	GEMINI_API_KEY=$(KEY) OPENAI_API_KEY=$(KEY) npx tsx src/cli/calypso-server.ts

calypso-cli:
	bash scripts/generate-version.sh
	@echo "Starting Calypso CLI client (HTTP)..."
	npx tsx src/cli/calypso-cli.ts

calypso-ws:
	bash scripts/generate-version.sh
	@echo "Starting Calypso CLI client (WebSocket)..."
	npx tsx src/calypso/cli/main.ts

test-oracle:
	@echo "Running ORACLE integration tests..."
	@echo "Building latest JS artifacts for ORACLE runner..."
	@npm run build > /dev/null
	node scripts/oracle-runner.mjs

test-oracle-verbose:
	@echo "Running ORACLE integration tests (verbose)..."
	@echo "Building latest JS artifacts for ORACLE runner..."
	@npm run build > /dev/null
	node scripts/oracle-runner.mjs --verbose
