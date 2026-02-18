# ARGUS Development Context

This document captures the architectural trajectory of ARGUS so current decisions can be understood in sequence rather than as disconnected patches.

## Narrative Timeline

### 2026-02-18 (v10.x): SeaGaP Boundary Realignment (Search vs Gather)

Stage ownership was realigned so code structure matches the SeaGaP spine:

1. Gather-owned runtime, controllers, actions, workspace, and UI helpers were moved from
   `src/core/stages/search/*` into `src/core/stages/gather/*`.
2. `search.ts` was reduced to discovery concerns (auth/runtime bootstrap, query/filtering,
   selection toggles, result rendering).
3. `gather.ts` now owns gather-target project context, dataset gather overlays, template/workspace
   transitions, and Gather→Process gating (`proceedToCode_handle`).
4. Window bindings and browser adapter routes were rewired so gather-specific UI triggers and
   actions resolve through Gather-stage entry points instead of Search-stage exports.

Result: stage semantics are now explicit in source topology, reducing Search/Gather conflation and
making SeaGaP progression easier to reason about and maintain.

### 2026-02-18 (v10.x): Plugin Boundary Enforcement

A hard architectural guard now enforces that plugin modules remain stage-agnostic:

1. Added `scripts/check-plugin-boundaries.mjs` to reject any import from
   `src/plugins/*` into `src/core/stages/*`.
2. Wired the guard into both `npm run build` and `npm test`.
3. Documented the rule in the TypeScript style guide under architecture mandates.

Result: the CLI/headless plugin path remains decoupled from web stage adapters, preserving
the Host/Plugin contract and SeaGaP stage ownership boundaries.

### 2026-02-18 (v10.x): Default Runtime Flipped to Store+Join

ARGUS now runs with `store+join` as the default materialization model:

1. `CalypsoCore` now defaults to `runtimeMaterialization='store'` and join materialization ON.
2. ORACLE harness explicitly instantiates `store+join` to keep integration verification aligned
   with production target posture.
3. Legacy write mode is retained only as a compatibility/deprecation path and now emits a
   deprecation warning when explicitly enabled.
4. Legacy-read compatibility remains intentionally supported for historical session trees.

Verification baseline after this change:
- Unit tests: `328/328` passing (13 files)
- ORACLE scenarios: `8/8` passing
- Build/typecheck: green

### 2026-02-18 (v10.x): Phase 3 Compatibility + Stale Blocking

Dual-layout read compatibility is now active in runtime gating paths:

1. Transition completion/staleness checks now use artifact fingerprint discovery instead of
   fixed topology file paths, making checks resilient across both legacy and join-materialized trees.
2. `WorkflowSession.verify_fast()` now validates parent readiness via fingerprint discovery,
   so persisted active-stage pointers remain valid across both layouts.
3. Stale prerequisite blocks are now surfaced as `BLOCKED_STALE` at the Calypso protocol layer.

Verification baseline after this change:
- Unit tests: `328/328` passing (13 files)
- ORACLE scenarios: `8/8` passing (including explicit stale-block expectation)
- Build/typecheck: green

### 2026-02-18 (v10.x): Phase 2 Join Writes Enabled Behind Toggle

Join-node runtime write behavior is now implemented in the Calypso materialization path when the
new runtime flags are used (`runtimeMode: 'store'` plus join toggle). Multi-parent stages now
materialize `_join_<parents>` nodes, write `join.json` + parent references, and place downstream
descendants under the join lineage.

Default runtime behavior remains unchanged (`legacy` mode) so existing sessions are unaffected.

Verification baseline after this change:
- Unit tests: `328/328` passing (13 files)
- ORACLE scenarios: `8/8` passing
- Build/typecheck: green

### 2026-02-18 (v10.x): Phase 1 Runtime Scaffolding Landed

Phase 1 of join-runtime integration is now implemented in code and verified:

1. `MerkleEngine` can optionally route writes through `SessionStore` + `VfsBackend`
   (`runtimeMode: 'store'`), while keeping `legacy` direct-path behavior as default.
2. `SessionStore` gained a compatibility path mode (`rootStageInOwnDirectory`) so runtime
   store routing can preserve current bridge/session path shape (`search/data/...`).
3. Join runtime toggles are wired (`joinMaterializationEnabled`,
   `ARGUS_RUNTIME_JOIN_MATERIALIZE`) but remain no-op for topology writes in this phase.

Verification baseline after landing:
- Unit tests: `328/328` passing (13 files)
- ORACLE scenarios: `8/8` passing
- Build/typecheck: green

This keeps runtime behavior stable while establishing the wiring needed for Phase 2
join-node materialization.

### 2026-02-18 (v10.x): Join-Node Runtime Integration Plan

ARGUS completed bridge-test contract alignment and restored a clean verification baseline
(`317/317` unit tests, `8/8` ORACLE scenarios). With baseline stability re-established, the
next architectural step is integrating topological join-node materialization (`_join_<parents>`)
into the live Calypso runtime for multi-parent DAG convergence.

The implementation approach is intentionally phased:

1. Wire runtime materialization through `dag/store` abstractions (`SessionStore` + `StorageBackend`).
2. Add join-node write behavior behind a toggle, preserving legacy primary-parent sessions.
3. Make readers/path resolution tolerant of both layouts during migration.
4. Promote join materialization to default only after full unit/oracle/build/typecheck gates pass.

This preserves backward compatibility while moving the provenance tree toward explicit,
self-documenting merge semantics.

### 2026-02-17 (v9.3.0): Manifest-Driven DAG Engine & Merkle Provenance

ARGUS achieved full architectural maturity by externalizing all persona-specific logic into declarative YAML manifests. The hardcoded workflow switchboards and persona-specific mappers were replaced with a generic DAG engine that dynamically scans for manifests and routes commands through manifest-defined stage handlers via `PluginHost`. This allows for open extension of the platform without core code modifications.

In parallel, the system implemented **Merkle Provenance Chains** across the DAG. Every workflow artifact now carries a SHA-256 fingerprint anchored to its ancestors, enabling deterministic staleness detection and branching. This transition completes the project's evolution from an LLM-guided prototype to a strictly grounded, machine-verifiable scientific instrument.

### 2026-02-12 (v7.2.0): Calypso WebSocket Service Architecture

The monolithic CLI (2081 lines) and HTTP-only server (456 lines) were decomposed into a layered WebSocket service with nine focused modules. A typed protocol layer enables shared sessions — multiple clients (TUI, future WUI, test harnesses) connect to the same CalypsoCore instance via WebSocket and see identical VFS/Store/workflow state. The duplicate script engine (~560 lines copied from ScriptRuntime) was eliminated. See `docs/legacy/calypso-architecture.adoc` for the historical specification.

This architecture provided the stable foundation for the manifest-driven sequencing that followed, solving the "context drift" and sequencing hallucinations observed in earlier versions.

### 2026-02-06 (v6.1.0): Data-State Grounding

The platform formalized a key principle: workflow progress is proven by materialized artifacts, not by optimistic in-memory counters. That brought ARGUS explicitly in line with ChRIS-style DAG semantics and clarified why markers such as `.harmonized`, `train.py`, and `.local_pass` are treated as state truth.

### 2026-02-04 (v6.0.0): Local Loop Update

Execution was reorganized into a tiered model. Local training became a first-class checkpoint with realistic log simulation and `.local_pass` certification, federation simulation became gated on local readiness, and `federate` was reframed as a transformation pipeline that stages code adaptation, packaging, and remote dispatch.

### 2026-02-03 (v5.0.0): Oracle Update

CALYPSO was split into a DOM-free core that can run identically in Node and browser contexts. This enabled headless server mode, CLI coupling to the same runtime, and ORACLE-style reflexive integration testing through natural-language command execution plus state assertions.

### 2026-01-31 to 2026-01-30: Quality-of-Life and Framework Codification

The project consolidated filesystem-first workflows, cleaner draft project creation, upload flows, and practical stage UX improvements while codifying architectural patterns in explicit framework documentation. The system's working conventions moved from tribal knowledge to durable specification.

### 2026-01-30 (v4.5.0 and v4.4.0): Overlay Guard and Gather Update

The UI moved from fragile shared DOM mutation toward a slot-driven multi-mode overlay system. In parallel, Search and Gather were fused into a more cohesive inline data assembly workflow with better project continuity and explicit selection economics.

### 2026-01-29 to 2026-01-28: Workspace and Visual Language Convergence

The right-frame workspace became a practical split tooling surface with terminal and file browser coordination, and visual semantics between projects and marketplace assets were unified through reusable card and detail patterns. Motion language and frame-slot behavior were also formalized.

### 2026-01-29 to 2026-01-26: Style Sweep, VCS, and Federalization Pivot

The codebase eliminated pervasive `any` usage, adopted strict RPN naming consistency, and decomposed large monolithic flows into typed modular services. Simultaneously, the in-memory Virtual Computer System reached production-grade structure, and ARGUS pivoted from local-only metaphors to the federation-first ATLAS Factory model.

## What ARGUS Is

ARGUS, the ATLAS Resource Guided User System, is the operating console for federated medical imaging workflows. It is named after Argus Panoptes to emphasize visibility, not merely aesthetics: the system is meant to make distributed state legible and actionable.

## Core Workflow Model

All interaction centers on SeaGaP-MP: Search, Gather, Process, Monitor, and Post. The sequence is not decorative process theater; each stage represents a distinct state transition with expected artifacts and operational controls.

## Current Vertical Focus

The most mature vertical remains the Federated ML Developer flow. Marketplace exploration, cohort assembly, code scaffolding, local training simulation, and federated dispatch are all represented with deterministic state mutation and testable outputs.

## Runtime and Test Posture

ARGUS runs in both full browser mode and headless CALYPSO mode. Unit tests cover VFS, shell, content registry, workflow logic, and simulation primitives, while ORACLE scenarios verify integrated behavior through the same conversational interface exposed to users.
