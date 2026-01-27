# ARGUS Development Context

## Recent Refactoring Activity
- **2026-01-26**: Extracted `telemetry.ts` to resolve circular dependencies.
- **2026-01-26**: Extracting `monitor.ts` (Monitor stage logic) from `argus.ts`.
- **2026-01-26**: Cleaning up `argus.ts` by removing extracted logic and adding imports.
- **2026-01-26**: Extracting `post.ts` and `login.ts` to further decompose the monolith.
- **2026-01-26**: Extracting `navigation.ts` to resolve circular dependencies.
- **2026-01-26**: Removed leaked API keys from test scripts and advised key rotation.
- **2026-01-26**: Fixed "Project View" visibility bug by forcing initial workspace render state.
## Recent Refactoring Activity

- **2026-01-26 (v3.1.0)**: Introduced the ATLAS Marketplace ecosystem for ChRIS plugins and reference assets.
- **2026-01-26 (v3.1.0)**: Implemented high-density Marketplace UI with VFS integration.
- **2026-01-26 (v3.0.0)**: Major release centering on the "Federalization" workflow.
- **2026-01-26 (v3.0.0)**: Introduced `federate` command to replace local execution metaphor.
- **2026-01-26 (v3.0.0)**: Established `docs/design.adoc` and finalized Pub/Sub migration.
- **2026-01-26**: Started architectural migration to Pub/Sub (Observer) pattern for robust state management.
- **2026-01-26**: Created `docs/architecture.adoc` to define the new event-driven design.
- **2026-01-26**: Completed full refactor of `argus.ts` into modular components.
- **2026-01-26**: Implemented true `VirtualFileSystem` (VFS) with path parsing and terminal synchronization.
- **2026-01-26**: Enhanced Terminal with Tab Completion, monospaced LCARS fonts, and robust intent handling.
- **2026-01-26**: Added "Federation Sequence" (Factory -> Distribution) to bridge Process and Monitor stages.
- **2026-01-26**: Built IDE-like interface for Process stage with synced File Explorer and Code Editor.
- **2026-01-26**: Fixed state synchronization and RAG context issues across all modules.

This document captures the development context for continuing work on ARGUS with minimal ramp-up.


## What is ARGUS?

**ARGUS** = **A**TLAS **R**esource **G**raphical **U**ser **S**ystem

Named after Argus Panoptes, the hundred-eyed giant from Greek mythology—the all-seeing guardian. ARGUS is the UI layer for the ATLAS federated medical imaging platform.

## Core Framework: SeaGaP-MP

All user interactions follow the **SeaGaP-MP** workflow:

| Stage | Purpose |
|-------|---------|
| **Search** | Query catalog for resources (datasets, models, apps) |
| **Gather** | Assemble selections into virtual filesystem cohort |
| **Process** | Perform work (training, annotation, inference) |
| **Monitor** | Track progress, costs, node status |
| **Post** | Publish/persist results to marketplace |

This pattern applies to ALL personas with stage-specific variations.

## User Personas

| Persona | Primary Goal | Notes |
|---------|--------------|-------|
| **Developer** | Train ML models | Current prototype focus |
| **Annotator** | Label images | Annotations go to marketplace |
| **User** | Run inference | Simplest workflow |
| **Data Provider** | Manage contributed data | Inverted pattern—visibility into usage |
| **App Developer** | Build MERIDIAN apps | Beyond ML models |
| **Administrator** | Platform governance | Audit, compliance, user mgmt |

## Current Prototype State

### Implemented (Developer Vertical)

- **Search**: Mock catalog with 6 chest X-ray datasets, filters for modality/annotation type
- **Gather**: Virtual filesystem tree view, file preview, cost estimation panel
- **Process**: Code template display (Python training script), launch button
- **Monitor**: Animated training simulation with:
  - Progress bar and epoch counter
  - Loss chart (canvas-based)
  - 5-node status cards (4 training nodes + 1 aggregator)
  - Cost tracking with abort capability
- **Post**: Model publishing form with name, description, license, pricing

### Not Yet Implemented

- Real backend integration (all data is mocked)
- Other personas (Annotator, User, etc.)
- Actual ChRIS/MERIDIAN API calls
- Authentication/authorization
- Real cost calculation

## Key Technical Decisions

### Naming Convention (RPN Style)

Functions use `<object>_<method>` pattern per TYPESCRIPT-STYLE-GUIDE.md:

```typescript
function catalog_search(): void { ... }
function dataset_toggle(id: string): void { ... }
function training_launch(): void { ... }
function nodeStatus_render(): void { ... }
```

### Source Structure

```
src/
├── core/
│   ├── stages/       # SeaGaP-MP base implementations (empty, for future)
│   └── models/       # TypeScript interfaces
├── personas/         # Persona-specific overrides (empty, for future)
│   ├── developer/
│   ├── annotator/
│   ├── user/
│   └── dataProvider/
├── ui/
│   ├── lcars/        # LCARS theme (empty, CSS is in dist/)
│   └── components/   # Shared widgets (empty, for future)
├── lib/              # Platform integration (empty, for future)
└── utils/            # Helpers (empty, for future)
```

Currently, all code is in `src/argus.ts` for simplicity. Structure exists for future decomposition.

### UI Technology

- **LCARS theme**: Star Trek-inspired interface from theLCARS.com
- **No framework**: Vanilla TypeScript compiled to ES modules
- **CSS variables**: All colors/dimensions configurable via `:root`

## How to Run

```bash
cd /home/rudolphpienaar/src/argus
npm install        # First time only
npm run build      # Compile TypeScript
npm run serve      # http://localhost:8080
```

## Connection to ATLAS Ecosystem

- **ATLAS** = Advanced Training and Learning At Scale (the platform)
- **MERIDIAN** = Multi-tenant Execution Runtime for Integrated Distributed Infrastructure in ATLAS Nodes (the compute standard)
- **ChRIS** = ChRIS Research Integration System (the underlying framework)
- **Trusted Domain (TD)** = Kubernetes-orchestrated deployment unit at each institution

ARGUS is the user-facing window into this ecosystem.

## Sample Data

9 chest X-ray images in `data/` from:
- Wikimedia Commons (public domain)
- COVID Chest X-ray Dataset (GitHub: ieee8023/covid-chestxray-dataset)

Used as thumbnails and file preview content in the prototype.

## Immediate Next Steps (Suggestions)

1. **Decompose argus.ts** - Split into per-stage modules under `src/core/stages/`
2. **Add Annotator vertical** - Similar SeaGaP-MP flow but Process stage = annotation UI
3. **Mock API layer** - Prepare for real backend by abstracting data access
4. **Responsive improvements** - LCARS CSS has breakpoints but needs testing

## Related Documents

- `docs/philosophy.adoc` - Full design philosophy and persona details
- `TYPESCRIPT-STYLE-GUIDE.md` - Coding conventions (RPN naming, typing rules)
- `README.md` - User-facing project overview

## Key Files to Read First

1. `src/argus.ts` - All application logic (mock data, state, UI functions)
2. `dist/index.html` - HTML structure with all stage content
3. `dist/css/lcars.css` - Theme styling and CSS variables
4. `src/core/models/types.ts` - TypeScript interfaces

---

*Last updated: 2026-01-23*
