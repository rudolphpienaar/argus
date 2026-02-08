# ARGUS

**ATLAS Resource Graphical User System**

ARGUS is the user-facing intelligence console for ATLAS (Advanced Training and Learning At Scale), a federated medical imaging platform designed for distributed machine learning across secure institutional boundaries. The project functions as both high-fidelity prototype and executable reference architecture: it is meant to be used, not only described.

At its core, ARGUS combines SeaGaP-MP workflow orchestration, a browser-native Virtual Computer System, and a headless AI intent layer called CALYPSO that is shared between web and CLI surfaces. The design objective is simple: natural interaction on top, deterministic materialized state underneath.

## Getting Started

Use the standard TypeScript workflow.

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

## Architecture in Practice

The `src/vfs/` layer provides an in-memory POSIX-like filesystem with shell semantics and provider-backed content generation. The `src/core/state/` layer provides centralized state and events. Deterministic intent orchestration lives in `src/core/logic/ProjectManager.ts`, and the DOM-free CALYPSO core lives in `src/lcarslm/` so that browser, CLI, and test harnesses all execute the same operational logic.

## Calypso CLI

`calypso-cli` connects to the headless CALYPSO server and supports shell commands, workflow commands, transcript replay, script discovery through `/scripts`, and script execution through `/run <script>`. Detailed usage patterns are documented in `backstory/powertoys.md` and `scripts/calypso/README.md`.

## Documentation

Developer onboarding begins with `docs/onboarding.adoc`. Architectural conventions are documented in `docs/framework.adoc`. Virtual filesystem behavior is defined in `docs/vcs.adoc`. The CALYPSO architecture is specified in `docs/calypso.adoc`, and ORACLE integration testing is described in `docs/oracle.adoc`.

Core technical docs:

- [Developer Onboarding](docs/onboarding.adoc)
- [Architecture](docs/architecture.adoc)
- [Framework Patterns](docs/framework.adoc)
- [VCS Specification](docs/vcs.adoc)
- [Calypso AI Core](docs/calypso.adoc)
- [SeaGaP Workflow](docs/seagap-workflow.adoc)
- [Persona Workflows](docs/persona-workflows.adoc)
- [ORACLE Testing](docs/oracle.adoc)
- [Visual Language](docs/visual_language.adoc)
- [Intents and Routing](docs/intents.adoc)

Project context docs:

- [Development Context Timeline](docs/CONTEXT.md)
- [Session State](SESSION-STATE.md)
- [TypeScript Style Guide](TYPESCRIPT-STYLE-GUIDE.md)

## Backstory and Narrative

If you want the full narrative, start with [The ARGUS Story](backstory/story.md). It is the coherent long-form chapter that ties together product intent, architecture philosophy, and interaction posture.

Companion chapters:

- [Backstory Index](backstory/README.md)
- [Mythological Metaphor](backstory/mythology.md)
- [Star Trek Connection](backstory/trek.md)
- [Power User Workflows](backstory/powertoys.md)
- [Credits and Acknowledgments](backstory/credits.md)

## Script Documentation

Structured and legacy `.clpso` behavior is documented in [Calypso Scripts (`.clpso`)](scripts/calypso/README.md).
