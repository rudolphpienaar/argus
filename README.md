# ARGUS

**ATLAS Resource Graphical User System**

ARGUS (**A**TLAS **R**esource **G**raphical **U**ser **S**ystem) is the conceptual UI layer for **ATLAS** (Advanced Training and Learning At Scale), a platform designed to enable federated machine learning on medical imaging data across distributed, secure institutional nodes.

ARGUS is a high-fidelity prototype and reference architecture for:

- SeaGaP-MP workflow orchestration (`Search`, `Gather`, `Process`, `Monitor`, `Post`)
- a browser-based Virtual Computer System (VFS + Shell)
- a headless AI intent layer (**Calypso**) shared between web and CLI

## Getting Started

ARGUS is a standard TypeScript project.

```bash
# Install dependencies
make install

# Build and compile
make build

# Start the local development server (http://localhost:8080)
make serve

# Start headless Calypso server (no browser required)
make calypso

# Connect to Calypso via CLI
make calypso-cli
```

## Architecture Snapshot

- **VCS (`src/vfs/`)**: in-memory POSIX-like filesystem, shell, providers, lazy content generation
- **State (`src/core/state/`)**: Vanilla TS Store + EventBus Pub/Sub
- **Intent Layer (`src/core/logic/ProjectManager.ts`)**: deterministic orchestration for gather/rename/harmonize
- **Calypso (`src/lcarslm/`)**: DOM-free AI core with browser, CLI, and test adapters

## Calypso CLI

The `calypso-cli` connects to the headless Calypso server (`make calypso`) and supports:

- shell + workflow commands in one stream
- transcript paste replay
- external `.clpso` flow scripts via `/run <script>`

See `backstory/powertoys.md` and `scripts/calypso/README.md` for usage patterns.

## Documentation

*   **[Developer Onboarding](docs/onboarding.adoc)**: Start here to understand the mental model and codebase structure.
*   **[Framework Patterns](docs/framework.adoc)**: A guide to the architectural conventions (RPN naming, Store/Events) used in the project.
*   **[VCS Specification](docs/vcs.adoc)**: Details on the in-memory filesystem and provider architecture.
*   **[Calypso AI Core](docs/calypso.adoc)**: The headless AI layer — architecture, CLI usage, and adapters.
*   **[ORACLE Testing](docs/oracle.adoc)**: Reflexive verification methodology using Calypso as the test driver.

## Backstory and Power Tools

The narrative and historical context moved out of this root README:

*   **[Backstory Index](backstory/README.md)**
*   **[Mythology](backstory/mythology.md)**
*   **[Star Trek Connection](backstory/trek.md)**
*   **[Power User Workflows](backstory/powertoys.md)**

## Acknowledgments

Detailed project credits are documented in:

*   **[backstory/credits.md](backstory/credits.md)**
