# ARGUS Development Context

## Recent Refactoring Activity

- **2026-01-30 (v4.5.1)**: **"The Framework Codification"** - Formalized the implicit framework patterns into `docs/framework.adoc`: Store + EventBus reactivity, the Slot Pattern (multi-mode overlays), the Populate/Teardown Lifecycle, the Component Pattern (class vs render function), the Provider Pattern (VCS tree builders), the Strip Pattern, the Selectable Mode, Window Binding conventions, CSS architecture, TypeScript conventions, and known extraction candidates. Documents anti-patterns with the actual regressions that taught them.
- **2026-01-30 (v4.5.0)**: **"The Overlay Guard"** - Replaced fragile shared-DOM innerHTML mutation with a multi-mode slot architecture. The `#asset-detail-overlay` now uses a `data-mode` attribute (`marketplace|project|dataset`) with three slot containers (`#overlay-sidebar-slot`, `#overlay-content-slot`, `#overlay-command-slot`). CSS attribute selectors handle visibility toggling — marketplace originals are never touched by project/dataset views. Eliminated `detailContent_restore()` and all cached innerHTML state. This structurally prevents the class of regression where one consumer corrupts another's DOM. Also fixed workspace→monitor transition: added `workspace_teardown()` to fully collapse split-pane layout, hide asset-detail overlay, and clear slots before `stage_advanceTo('monitor')` — the federation handshake was previously only hiding the federation-overlay, leaving the workspace blocking the monitor stage.
- **2026-01-30 (v4.4.0)**: **"The Gather Update"** - Fused Search and Gather stages into a single inline flow. Added persistent project strip (compact project chips always visible at top of Search stage) with three modes: work on existing project, search for new data, add data to existing project. Dataset tiles now open a detail overlay with a selectable FileBrowser — long-press files/folders to toggle selection for gathering. Command pills: DONE (commit selection), ADDITIONAL DATA (continue gathering), CANCEL. Per-file cost estimation (dataset cost / file count). Gathered dataset tiles show "GATHERED" badge. Accumulated subtrees merge into target project's VFS `/data` tree. New doc: `docs/seagap-workflow.adoc`. Dataset tiles now use `AssetCard` component for visual convergence.
- **2026-01-30 (v4.3.0)**: **"The Workspace Update"** - Implemented the interactive split-pane workspace layout. When a project is OPENed, the right-frame becomes a flex column with the Intelligence Console (terminal) on top and a FileBrowser below. Each panel has its own independent bottom-edge resize handle (`workspace-resize-handle`) — dragging the terminal handle resizes only the terminal; dragging the browser handle resizes only the file browser. The panels are fully decoupled (no zero-sum constraint); the page scrolls to accommodate total height. Added bidirectional tab↔terminal pwd sync via `Shell.onCwdChange_set()` callback. FileBrowser extracted as a reusable component with `trees_set()`, `tab_switch()`, `tree_render()`, `preview_show()`. Hidden stage content and bar-panel in workspace mode via `.workspace-active` class. 140 tests (57 Shell, 64 VFS, 16 ContentRegistry, 3 Costs).
- **2026-01-29 (v4.2.0)**: **"Visual Language Unification"** - Converged the UI design of Projects and Marketplace Assets. Refactored tile rendering into a shared `AssetCard` component. Updated the Federated ML landing screen to display projects as Marketplace-style tiles. Implemented a Project Detail overlay (reusing the Marketplace detail view) that provides a read-only file browser preview before project activation. *Note: Project Detail animation currently uses standard visibility toggles and does not yet mirror the sliding behavior of the Marketplace detail view.*
- **2026-01-29 (v3.5.0)**: **"The Style Sweep"** - Comprehensive codebase audit against the TypeScript Style Guide. Eliminated all `any` types from core application code (~35 instances). Renamed 20+ functions to RPN convention. Added JSDoc to ~50+ functions. Decomposed 3 long methods (130-line `terminalCommand_handle`, 165-line `app_initialize`, 103-line `assetDetail_open`). Replaced all `(window as any)` casts with typed `declare global { interface Window }` extensions. Changed all `catch (e: any)` to `catch (e: unknown)` with `instanceof Error` narrowing. Typed all lambda parameters and local variables across 14 source files.
- **2026-01-29 (v3.4.1)**: **"The VCS Update"** - Completed the 5-phase Virtual Computer System implementation. Replaced the hollow VFS with a content-aware filesystem, Shell interpreter, ContentRegistry with 14 template generators, and 3 Providers (Dataset, Project, Marketplace). 134 tests across VFS (64), Shell (51), ContentRegistry (16), and Costs (3).
- **2026-01-28 (v3.4.0)**: **"The Visual Language Update"** - Introduced the Frame Slot system: a two-phase "double whammy" animation where LCARS panels open, then content slides in from the right. Added the Beckon Pulse pattern for interactive affordances. Documented the emerging visual language in `docs/visual_language.adoc`. New components: `SlidePanel`, `FrameSlot`.
- **2026-01-28 (v3.3.0)**: **"The Modularization Update"** - Decoupled core UI components (Terminal, Telemetry, Workflow) into a reusable `lcars-framework`. Replaced hardcoded HTML stations with a procedural `WorkflowTracker`.
- **2026-01-26 (v3.2.1)**: **"The Telemetry Restore"** - Fixed a regression where SeaGaP telemetry windows were missing due to placeholder comments. Unified telemetry logic into a registry-based service.
- **2026-01-26 (v3.1.0)**: **"The Marketplace Update"** - Scaled the registry to 400+ "Pro-ified" assets (Plugins, Datasets, Annotations, Models) with functional category filtering.
- **2026-01-26 (v3.1.0)**: **Virtual Filesystem Integration** - Marketplace installs now dynamically populate the VCS at `/bin/`, `/data/sets/`, `~/models/`, etc.
- **2026-01-26 (v3.0.0)**: **"The Federalization Update"** - Pivoted to the ATLAS Factory execution model. Replaced local metaphors with `federate` command and build-sequence animations.
- **2026-01-26 (v3.0.0)**: **Architectural Overhaul** - Migrated to a **Pub/Sub (Observer)** pattern. Centralized state in a `Store` with an `EventBus` for decoupled, reactive Vanilla JS.
- **2026-01-26**: **Modularization Complete** - Fully decomposed the monolithic `argus.ts` into stage-specific modules in `src/core/stages/`.
- **2026-01-26**: **VCS Implementation** - Created a true in-memory Virtual Computer System with Shell, ContentRegistry, and Providers.
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
| **Federated ML Developer** | Train ML models | **Primary Focus of current prototype** |
| **App Developer** | Build MERIDIAN apps | Packaging and deployment workflow |
| **Annotator** | Label images | Process stage features annotation UI |
| **User** | Run inference | Streamlined inference-only flow |
| **Data Provider** | Manage data | Visibility into usage and node health |

## Current Prototype State

### Implemented (Federated ML Developer Vertical)

- **Marketplace**: High-density registry of 400+ unique, technically nuanced medical AI assets.
- **VCS**: Full Virtual Computer System — in-memory POSIX-like filesystem with content-aware files, Shell interpreter (15 builtins, env vars, `$PS1` prompt), ContentRegistry with 14 lazy-evaluated template generators, and 3 Providers (Dataset, Project, Marketplace).
- **Terminal**: Intelligence Console with AI (Gemini/OpenAI) and local command modes. Shell-backed with tab completion.
- **Search**: Dynamic project/dataset catalog with AI-driven filtering.
- **Gather**: VCS tree view, expert file previews, and cost estimation.
- **Process**: Split-pane IDE with synced file explorer, syntax highlighting, and `federate` workflow.
- **Federalization Overlay**: Animated "Factory" build and distribution sequence.
- **Monitor**: Real-time training simulation with Loss Charts and Hacker Telemetry.

### Key Technical Decisions

- **Pure Vanilla TS**: No frontend frameworks (React/Vue). Reactivity is achieved via a custom Pub/Sub `Store`.
- **RPN Naming**: Functions use `<subject>_<verb>` pattern (e.g., `store.marketplace_toggle()`, `catalog_search()`, `dataset_select()`).
- **LCARS Theme**: Star Trek-inspired high-fidelity interface with modern CSS variables.
- **Typed Window Bindings**: `declare global { interface Window }` extensions replace `(window as any)` casts for onclick handler exposure.
- **Explicit Typing**: Every const, lambda, parameter, and return type has explicit annotations. `any` is eliminated from core code; `unknown` with `instanceof` narrowing is used for catch blocks.

### Test Coverage

| Suite | Tests | Module |
|-------|-------|--------|
| VirtualFileSystem | 64 | Path resolution, CWD, CRUD, mount/unmount, lazy content, events |
| Shell | 57 | Env vars, prompt, builtins, stage transitions, external handlers, cwd change callback |
| ContentRegistry | 16 | Registration, resolution, VFS integration, 8 template generators |
| Costs | 3 | Cost estimation engine |
| **Total** | **140** | |

## Source Structure

```text
src/
├── lcars-framework/  # Reusable Library (Terminal, Telemetry, Workflow, UI)
├── core/
│   ├── data/         # Mock registries (datasets, projects, marketplace, nodes)
│   ├── logic/        # Navigation, Costs, Telemetry
│   ├── models/       # TypeScript Interfaces (AppState, Dataset, Project, etc.)
│   ├── stages/       # SeaGaP stage implementations (search, gather, process, monitor, login)
│   └── state/        # Store (centralized state) and EventBus (Pub/Sub)
├── lcarslm/          # AI Core / RAG Engine (OpenAI, Gemini clients)
├── marketplace/      # Marketplace View and Logic
├── telemetry/        # App-specific Telemetry Setup
├── ui/               # ARGUS-specific UI wrappers (Terminal, FrameSlot, SlidePanel, LCARSFrame, Gutters)
├── vfs/              # Virtual Computer System
│   ├── VirtualFileSystem.ts   # Core: tree + content + CWD + events
│   ├── Shell.ts               # Command interpreter + env vars + prompt
│   ├── types.ts               # FileNode, ShellResult, ContentContext
│   ├── content/
│   │   ├── ContentRegistry.ts # Path → generator mapping + lazy evaluation
│   │   └── templates/         # 14 content generators (train, readme, config, etc.)
│   └── providers/
│       ├── DatasetProvider.ts     # Builds ~/data/cohort/
│       ├── ProjectProvider.ts     # Scaffolds $HOME + ~/src/project/
│       └── MarketplaceProvider.ts # Installs assets to /bin, /data/sets, etc.
└── argus.ts          # Main entry point and window orchestration
```

## How to Run

```bash
npm run build      # Compile TypeScript
npm run serve      # http://localhost:8080 (or 'make serve')
npm run test       # Run 140 unit tests
```

---
*Last updated: 2026-01-30 (v4.5.1)*
