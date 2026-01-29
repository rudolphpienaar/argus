# ARGUS

**ATLAS Resource Graphical User System**

ARGUS is the primary user interface for the [ATLAS](https://github.com/FNNDSC/ATLAS) federated medical imaging platform. The name draws from Greek mythology—Argus Panoptes, the hundred-eyed giant whose vigilance made him the perfect guardian. ARGUS provides comprehensive visibility into distributed resources across federated Trusted Domains.

## Overview

ARGUS implements the **SeaGaP-MP** workflow framework:

| Stage | Description |
|-------|-------------|
| **Search** | Query the ATLAS catalog for datasets, models, or services |
| **Gather** | Assemble selected resources into a virtual filesystem cohort |
| **Process** | Perform work (train models, annotate, run inference) |
| **Monitor** | Track progress, costs, and node status in real-time |
| **Post** | Publish results to the ATLAS marketplace |

## Current Status

This repository contains a **prototype** of the Developer vertical—demonstrating the workflow for training federated ML models on distributed medical imaging data.

### Features

- LCARS-themed UI (Star Trek inspired interface)
- Virtual Computer System (VCS) with Shell, content-aware filesystem, and providers
- Intelligence Console with AI (OpenAI/Gemini) and 15 Unix-like builtins
- Marketplace with 400+ medical AI assets (plugins, datasets, models, annotations)
- Simulated federated training across 5 Trusted Domains
- Real-time training progress with loss charts
- Cost tracking with abort capability
- Split-pane IDE with syntax highlighting

## Quick Start

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Serve the prototype
npm run serve
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
│   ├── lcars-framework/        # Reusable Library (Terminal, Telemetry, Workflow)
│   ├── core/
│   │   ├── data/               # Mock registries (datasets, projects, marketplace, nodes)
│   │   ├── logic/              # Navigation, Costs, Telemetry
│   │   ├── models/             # TypeScript interfaces (AppState, Dataset, Project, etc.)
│   │   ├── stages/             # SeaGaP stage implementations
│   │   └── state/              # Store (centralized state) and EventBus (Pub/Sub)
│   ├── lcarslm/                # AI Core (OpenAI, Gemini clients)
│   ├── marketplace/            # Marketplace view and install logic
│   ├── telemetry/              # App-specific telemetry setup
│   ├── ui/                     # UI wrappers (Terminal, FrameSlot, SlidePanel, LCARSFrame)
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

## User Personas

ARGUS serves multiple user types:

- **Developer** - Build and train ML models (current prototype)
- **Annotator** - Label medical images
- **User** - Run inference with existing models
- **Data Provider** - Manage contributed datasets
- **App Developer** - Build MERIDIAN-compliant applications
- **Administrator** - Platform governance

## Technology

- TypeScript 5.0+ with strict mode
- LCARS CSS theme (adapted from [theLCARS.com](https://www.thelcars.com))
- Vanilla JS runtime (no framework dependencies)
- RPN naming convention (`subject_verb` pattern)
- Vitest for testing (134 tests)

## Testing

```bash
# Run all 134 tests
npm run test

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

- LCARS theme based on work by Jim Robertus ([theLCARS.com](https://www.thelcars.com))
- Sample chest X-ray images from [COVID Chest X-ray Dataset](https://github.com/ieee8023/covid-chestxray-dataset) and Wikimedia Commons
