# ARGUS

**ATLAS Resource Graphical User System**

ARGUS is a functional mock-up — bordering on prototype — for rapidly exploring interface ideas for the [ATLAS](https://github.com/FNNDSC/ATLAS) federated medical imaging platform. The name draws from Greek mythology: Argus Panoptes, the hundred-eyed giant whose vigilance made him the perfect guardian.

ARGUS is not a production UI. It is a design and interaction laboratory built to answer questions about how developers, annotators, and other personas might interact with federated medical imaging resources through an AI-enhanced Intelligent Terminal.

## What It Explores

The current focus is the **Developer persona** — a federated ML developer who searches for datasets, assembles cohorts, launches distributed training across Trusted Domains, and monitors results. The primary interaction surface is the **Intelligence Console**: a hybrid terminal that blends Unix-like shell commands with natural language AI queries in a single stream.

The **SeaGaP-MP** workflow (Search, Gather, Process, Monitor, Post) informs the underlying narrative thread, but the interface is responsive and exploratory rather than a rigid stage-gate pipeline.

## The Virtual Computer System (VCS)

The **VCS** is the stateful runtime environment underlying the ARGUS Intelligence Terminal. Unlike a static UI mock-up, the VCS provides a living, in-memory POSIX-like filesystem that maintains state across interactions.

- **Filesystem:** Supports directories, files with content, and standard CRUD operations.
- **Shell:** A command interpreter supporting pipes, environment variables (`$HOME`, `$PATH`), and 15 builtin commands (e.g., `cd`, `ls`, `cat`, `grep`, `open`).
- **Content Providers:** Dynamic bridges that map application state (Datasets, Projects, Marketplace Assets) into the filesystem as "virtual files," allowing users to interact with rich objects using standard CLI tools.

### Features

- LCARS-themed UI (Star Trek inspired interface)
- AI-enhanced Intelligence Console (OpenAI/Gemini) with 15 Unix-like builtins
- Marketplace with 400+ medical AI assets (plugins, datasets, models, annotations)
- Simulated federated training across 5 Trusted Domains
- Real-time training progress with loss charts
- Cost tracking with abort capability
- Split-pane IDE with syntax highlighting

## Quick Start

```bash
# Install dependencies
make install

# Build TypeScript
make build

# Serve the prototype
make serve
```

Then open http://localhost:8080

## Project Structure

```
argus/
├── docs/
│   ├── CONTEXT.md              # Development context and changelog
│   ├── architecture.adoc       # Pub/Sub architecture, event catalog, VCS
│   ├── design.adoc             # SeaGaP-MP paradigm, Federalization model
│   ├── dev.adoc                # Developer notes, LCARS reference, testing
│   ├── lcars.adoc              # LCARS interface and component system
│   ├── marketplace.adoc        # Marketplace asset types and lifecycle
│   ├── modularization.adoc     # LCARS Framework extraction plan
│   ├── philosophy.adoc         # Conceptual design philosophy
│   ├── vcs.adoc                # Virtual Computer System specification
│   └── visual_language.adoc    # Animation patterns and visual design
│
├── src/
│   ├── lcars-framework/        # Reusable Library
│   │   ├── telemetry/          # Telemetry generators & renderers
│   │   └── ui/                 # Shared UI components (Terminal, WorkflowTracker)
│   ├── core/
│   │   ├── data/               # Mock registries (datasets, projects, marketplace, nodes)
│   │   ├── logic/              # Navigation, Costs, Telemetry
│   │   ├── models/             # TypeScript interfaces (AppState, Dataset, Project, etc.)
│   │   ├── stages/             # SeaGaP stage implementations
│   │   └── state/              # Store (centralized state) and EventBus (Pub/Sub)
│   ├── generated/              # Auto-generated version info
│   ├── lcarslm/                # AI Core (OpenAI, Gemini clients)
│   ├── marketplace/            # Marketplace view and install logic
│   ├── search/                 # Search Engine
│   │   ├── providers/          # Search providers (Nano, Mock)
│   │   └── engine.ts           # Search orchestration
│   ├── telemetry/              # App-specific telemetry setup
│   ├── ui/                     # Application UI
│   │   ├── components/         # LCARS Frames, Panels, Slots
│   │   └── gutters.ts          # Layout logic
│   ├── vfs/                    # Virtual Computer System
│   │   ├── VirtualFileSystem.ts    # In-memory POSIX-like filesystem
│   │   ├── Shell.ts                # Command interpreter (15 builtins, env vars, prompt)
│   │   ├── types.ts                # FileNode, ShellResult, ContentContext
│   │   ├── content/                # ContentRegistry + 14 template generators
│   │   └── providers/              # Dataset, Project, Marketplace providers
│   └── argus.ts                # Main entry point
│
├── dist/                       # Built output (HTML, CSS, JS)
├── TYPESCRIPT-STYLE-GUIDE.md   # Coding conventions (RPN, typing, JSDoc)
└── package.json
```

## Personas (Planned)

The Developer persona is the current focus. Future exploration may include:

- **Annotator** — Label medical images
- **User** — Run inference with existing models
- **Data Provider** — Manage contributed datasets
- **App Developer** — Build MERIDIAN-compliant applications
- **Administrator** — Platform governance

## Technology

- TypeScript 5.0+ with strict mode
- LCARS CSS theme (adapted from [theLCARS.com](https://www.thelcars.com))
- Vanilla JS runtime (no framework dependencies)
- RPN naming convention (`subject_verb` pattern)
- Vitest for testing (134 tests)

## Testing

```bash
# Run all 134 tests
make test

# Run specific suite
npx vitest run src/vfs/Shell.test.ts
```

| Suite | Tests |
|-------|-------|
| VirtualFileSystem | 64 |
| Shell | 51 |
| ContentRegistry | 16 |
| Costs | 3 |

## Related Projects

- [ATLAS](https://github.com/FNNDSC/ATLAS) - Advanced Training and Learning At Scale
- [ChRIS](https://github.com/FNNDSC/ChRIS_ultron_backEnd) - ChRIS Research Integration System
- [MERIDIAN](docs/philosophy.adoc) - Multi-tenant Execution Runtime for Integrated Distributed Infrastructure in ATLAS Nodes

## License

MIT

## Acknowledgments

- **Architect & Lead Developer:** Rudolph Pienaar (System Architecture, Source Layout, Design).
- **AI Assistance:** Implementation support and boilerplate generation provided by **Claude Code** (Anthropic), **Codex** (OpenAI), and **Gemini CLI** (Google), developed under the direction and review of the lead developer.
- **LCARS Theme:** Based on work by Jim Robertus ([theLCARS.com](https://www.thelcars.com)).
- **Data:** Sample chest X-ray images from [COVID Chest X-ray Dataset](https://github.com/ieee8023/covid-chestxray-dataset) and Wikimedia Commons.
