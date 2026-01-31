# ARGUS

**ATLAS Resource Graphical User System**

ARGUS is the UI layer for the [ATLAS](https://github.com/FNNDSC/ATLAS) federated medical imaging platform. It is an advanced architectural prototype demonstrating how a **Virtual Computer System (VCS)**, an **AI-Enhanced Intelligence Console**, and a **Strict Vanilla TypeScript Framework** can be combined to create a powerful, "No-Framework" web application.

> **Status:** Active Architectural Prototype / Foundation for Production
> **Version:** 4.5.1

## Core Capabilities

### 1. The Virtual Computer System (VCS)
ARGUS is not just a UI; it simulates a running computer in the browser.
*   **Full Filesystem**: In-memory, POSIX-like filesystem (`src/vfs/`) with directories, permissions, and content.
*   **Shell Interpreter**: A functional shell (`src/vfs/Shell.ts`) supporting pipes, environment variables (`$HOME`, `$PWD`), and builtins (`cd`, `ls`, `grep`, `cat`).
*   **Providers**: Bridges that mount application state (Datasets, Projects) as virtual files, allowing standard tools to interact with rich domain objects.

### 2. The Intelligence Console
A hybrid command-line interface that seamlessly blends:
*   **System Commands**: `ls`, `cd`, `mkdir` (executed by the Shell).
*   **Workflow Commands**: `search`, `mount`, `federate` (executed by the Command Router).
*   **Natural Language**: "Find chest x-ray datasets under $500" (executed by the AI Service via RAG).

### 3. The SeaGaP-MP Workflow
The application implements the ATLAS workflow for Federated Machine Learning:
*   **Search**: Discover datasets via AI or filters.
*   **Gather**: Inspect and mount cohorts into the VCS.
*   **Process**: Write code in a split-pane IDE backed by the VFS.
*   **Monitor**: Visualize real-time federated training across distributed nodes.
*   **Post**: Publish trained models to the Marketplace.

## The "No-Framework" Architecture

ARGUS is built without React, Vue, or Svelte. It relies on a rigorous set of architectural patterns to maintain scalability and type safety.

*   **Store + EventBus**: Centralized state management with a Pub/Sub backbone.
*   **RPN Naming**: Strict `object_method` naming convention (e.g., `project_load`, `dataset_select`) for discoverability.
*   **Slot Pattern**: Overlay management that prevents DOM corruption by using CSS-switched slots.
*   **LCARS Framework**: A decoupled UI library (`src/lcars-framework/`) implementing the Star Trek aesthetic.

See [docs/framework.adoc](docs/framework.adoc) for the full architectural specification.

## Quick Start

### Prerequisites
*   Node.js 18+
*   NPM

### Installation

```bash
# Install dependencies
make install

# Build the application
make build

# Start the development server
make serve
```

Open **http://localhost:8080** in your browser.

## Documentation

New developers should start here:

1.  **[Onboarding Guide](docs/onboarding.adoc)**: The "mental model" of the application and "Hello World" examples.
2.  **[Framework Patterns](docs/framework.adoc)**: The rules of the road (Naming, State, Components).
3.  **[Architecture](docs/architecture.adoc)**: High-level system design and service layers.
4.  **[VCS Specification](docs/vcs.adoc)**: Deep dive into the Virtual Computer System.

## Project Structure

```
argus/
├── src/
│   ├── argus.ts                # Application Orchestrator (Entry Point)
│   ├── lcars-framework/        # Decoupled UI Library (Terminal, Workflow)
│   ├── lcarslm/                # AI Service & RAG Engine
│   ├── marketplace/            # Marketplace View & Logic
│   ├── vfs/                    # Virtual Computer System (Shell, FS, Providers)
│   └── core/
│       ├── logic/              # Business Logic (Commands, Navigation, Lifecycle)
│       ├── state/              # Store & EventBus
│       ├── stages/             # SeaGaP Stage Implementations (Search, Process...)
│       └── models/             # TypeScript Interfaces
├── docs/                       # Comprehensive Documentation
└── dist/                       # Compiled Output
```

## Related Projects

- [ATLAS](https://github.com/FNNDSC/ATLAS) - Advanced Training and Learning At Scale
- [ChRIS](https://github.com/FNNDSC/ChRIS_ultron_backEnd) - ChRIS Research Integration System
- [MERIDIAN](docs/philosophy.adoc) - Multi-tenant Execution Runtime for Integrated Distributed Infrastructure

## License

MIT

## Acknowledgments

- **Architect & Lead Developer:** Rudolph Pienaar.
- **AI Assistance:** Development accelerated by **Claude Code** (Anthropic), **Codex** (OpenAI), and **Gemini CLI** (Google).
- **Design:** LCARS Theme based on work by Jim Robertus ([theLCARS.com](https://www.thelcars.com)).