# ARGUS Makefile
#
# Build and manage the ARGUS UI prototype

.PHONY: help install build serve dev clean watch argus

help:
	@echo "ARGUS Makefile"
	@echo ""
	@echo "Commands:"
	@echo "  make install  - Install npm dependencies"
	@echo "  make build    - Generate version and compile TypeScript"
	@echo "  make serve    - Start dev server on port 8080"
	@echo "  make dev      - Build and serve"
	@echo "  make watch    - Watch mode (rebuild on changes)"
	@echo "  make test     - Run unit tests"
	@echo "  make clean    - Remove build artifacts"
	@echo "  make argus    - Full cycle (clean, install, build)"

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
