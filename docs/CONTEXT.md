# ARGUS Development Context

## Recent Refactoring Activity

- **2026-01-28 (v3.4.0)**: **"The Visual Language Update"** - Introduced the Frame Slot system: a two-phase "double whammy" animation where LCARS panels open, then content slides in from the right. Added the Beckon Pulse pattern for interactive affordances. Documented the emerging visual language in `docs/visual_language.adoc`. New components: `SlidePanel`, `FrameSlot`.
- **2026-01-28 (v3.3.0)**: **"The Modularization Update"** - Decoupled core UI components (Terminal, Telemetry, Workflow) into a reusable `lcars-framework`. Replaced hardcoded HTML stations with a procedural `WorkflowTracker`.
- **2026-01-26 (v3.2.1)**: **"The Telemetry Restore"** - Fixed a regression where SeaGaP telemetry windows were missing due to placeholder comments. Unified telemetry logic into a registry-based service.
- **2026-01-26 (v3.1.0)**: **"The Marketplace Update"** - Scaled the registry to 400+ "Pro-ified" assets (Plugins, Datasets, Annotations, Models) with functional category filtering.
- **2026-01-26 (v3.1.0)**: **Virtual Filesystem Integration** - Marketplace installs now dynamically populate `/home/developer/bin/` in the VFS.
- **2026-01-26 (v3.0.0)**: **"The Federalization Update"** - Pivoted to the ATLAS Factory execution model. Replaced local metaphors with `federate` command and build-sequence animations.
- **2026-01-26 (v3.0.0)**: **Architectural Overhaul** - Migrated to a **Pub/Sub (Observer)** pattern. Centralized state in a `Store` with an `EventBus` for decoupled, reactive Vanilla JS.
- **2026-01-26**: **Modularization Complete** - Fully decomposed the monolithic `argus.ts` into stage-specific modules in `src/core/stages/`.
- **2026-01-26**: **VFS Implementation** - Created a true in-memory Virtual Filesystem with path parsing (`cd`, `ls`, `mkdir`, `touch`) and terminal sync.
- **2026-01-26**: **Terminal Enhancements** - Added Tab Completion, monospaced alignment, and high-fidelity intent parsing for AI commands.

## What is ARGUS?

**ARGUS** = **A**TLAS **R**esource **G**raphical **U**ser **S**ystem

Named after Argus Panoptes, the hundred-eyed giant from Greek mythology—the all-seeing guardian. ARGUS is the UI layer for the ATLAS federated medical imaging platform.

## Core Framework: SeaGaP-MP

All user interactions follow the **SeaGaP-MP** workflow:

| Stage | Purpose |
|-------|---------|
| **Search** | Query catalog for resources (datasets, models, apps) |
| **Gather** | Assemble selections into virtual filesystem cohort |
| **Process** | Perform work (federated build and code engineering) |
| **Monitor** | Track progress, costs, and distributed node status |
| **Post** | Publish/persist results to the Marketplace |

## User Personas

| Persona | Primary Goal | Notes |
|---------|--------------|-------|
| **Developer** | Train ML models | **Primary Focus of current prototype** |
| **Annotator** | Label images | Process stage features annotation UI |
| **User** | Run inference | Streamlined inference-only flow |
| **Data Provider** | Manage data | Visibility into usage and node health |

## Current Prototype State

### Implemented (Developer Vertical)

- **Marketplace**: High-density registry of 400+ unique, technically nuanced medical AI assets.
- **VFS**: Robust in-memory filesystem handling multi-segment paths and binary symlinking.
- **Terminal**: Intelligence Console with AI (Gemini/OpenAI) and local command modes. Supports Tab Completion.
- **Search**: Dynamic project/dataset catalog with AI-driven filtering.
- **Gather**: VFS tree view, expert file previews, and cost estimation.
- **Process**: Split-pane IDE with synced file explorer and `federate` workflow.
- **Federalization Overlay**: Animated "Factory" build and distribution sequence.
- **Monitor**: Real-time training simulation with Loss Charts and Hacker Telemetry.

### Key Technical Decisions

- **Pure Vanilla TS**: No frontend frameworks (React/Vue). Reactivity is achieved via a custom Pub/Sub `Store`.
- **RPN Naming**: Functions use `<object>_<method>` pattern (e.g., `store.toggleMarketplace()`).
- **LCARS Theme**: Star Trek-inspired high-fidelity interface with modern CSS variables.

## Source Structure

```text
src/
├── lcars-framework/  # Reusable Library (Terminal, Telemetry, UI)
├── core/
│   ├── data/         # Mock registries (datasets, projects, marketplace)
│   ├── logic/        # Navigation, VFS, Costs
│   ├── models/       # TypeScript Interfaces
│   ├── stages/       # Modular SeaGaP stage implementations
│   └── state/        # Store and EventBus (Pub/Sub)
├── lcarslm/          # AI Core / RAG Engine
├── marketplace/      # Marketplace View and Logic
├── telemetry/        # App-specific Telemetry Setup
├── ui/               # ARGUS-specific UI wrappers (SlidePanel, FrameSlot)
└── argus.ts          # Main entry point and window orchestration
```

## How to Run

```bash
npm run build      # Compile TypeScript
npm run serve      # http://localhost:8080 (or 'make serve')
```

---
*Last updated: 2026-01-28 (v3.4.0)*
