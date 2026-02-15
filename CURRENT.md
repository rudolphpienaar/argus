# CURRENT STATE — 2026-02-15

## What Just Happened

Completed the full DAG engine integration into CalypsoCore (Phase 2-3 of the plan in
`~/.claude/plans/snappy-marinating-fairy.md`). The old `WorkflowEngine` static class
with 5 hardcoded stages and `eval()`-based validation has been replaced by a
manifest-driven DAG engine with topology-aware session tree paths.

### Key Accomplishment: Topology-Aware Session Tree

The session directory tree now mirrors the DAG topology — each stage nests under its
primary parent, creating a filesystem structure that IS the provenance chain:

```
session-root/
  data/search.json                                          ← root stage
  gather/
    data/gather.json                                        ← child of root
    rename/data/rename.json                                 ← child of gather
    harmonize/
      data/harmonize.json                                   ← child of gather
      code/
        data/code.json
        train/
          data/train.json
          federate-brief/
            data/federate-brief.json
```

## Architecture After Migration

### DAG Engine (`src/dag/`)

| Layer | Files | Tests |
|-------|-------|-------|
| Graph | `graph/types.ts`, `graph/parser/manifest.ts`, `graph/resolver.ts` | 58 |
| Store | `store/SessionStore.ts`, `store/backend/vfs.ts`, `store/types.ts` | 40 |
| Fingerprint | `fingerprint/hasher.ts` | 27 |
| Bridge | `bridge/WorkflowAdapter.ts`, `bridge/CompletionMapper.ts`, `bridge/SessionPaths.ts` | 34 |
| Manifests | `manifests/fedml.manifest.yaml`, `manifests/chris.manifest.yaml` | — |

Total: 159 DAG tests + 164 other tests = **323 tests all passing**.

### Bridge Layer (the CalypsoCore-facing API)

```
WorkflowAdapter          — CalypsoCore's single entry point
  ├─ position_resolve()  — "where are we?" (queries VFS, returns WorkflowPosition)
  ├─ transition_check()  — "can we do X?" (soft-block with skip warnings)
  ├─ stage_forCommand()  — reverse index: command string → DAGNode
  ├─ skip_increment()    — manages soft-block counters
  ├─ progress_summarize()— human-readable progress string
  └─ stagePaths          — Map<string, StagePath> topology-aware paths

CompletionMapper         — Maps stage IDs → VFS artifact checks
  ├─ fedmlMapper_create()  — search/rename alias to gather, federation aliases to federate-brief
  └─ chrisMapper_create()  — publish never auto-completes (action stage)

SessionPaths             — Computes topology-aware paths from DAG structure
  └─ sessionPaths_compute() — walks parent chains, builds nesting paths
```

### CalypsoCore Session Lifecycle

1. **Constructor** creates session: `~/sessions/<workflow>/session-<timestamp>/`
2. **`sessionArtifact_write(stageId, content)`** writes `ArtifactEnvelope` at topology-aware path
3. All `position_resolve()`/`transition_check()` pass `this.sessionPath`
4. `FederationOrchestrator.session_set(artifactPath)` receives the full federate-brief path

### Dual-Write Pattern (Current)

Action handlers write BOTH:
- **Dotfile markers** to project workspace (`.cohort`, `.harmonized`, `.local_pass`, `.federated`) — consumed by Shell guards, CohortProfiler, FederationOrchestrator readiness checks
- **ArtifactEnvelopes** to session tree — source of truth for workflow state via CompletionMapper

Dotfile markers are legacy operational guards. Session tree artifacts are the DAG-grounded source of truth.

## What Was Deleted

| File | Reason |
|------|--------|
| `src/core/workflows/WorkflowEngine.ts` | Replaced by `WorkflowAdapter` |
| `src/core/workflows/definitions/fedml.ts` | Replaced by `fedml.manifest.yaml` |
| `src/core/workflows/definitions/chris.ts` | Replaced by `chris.manifest.yaml` |
| `src/core/workflows/WorkflowEngine.test.ts` | Replaced by `bridge.test.ts` |
| `src/core/logic/ProjectManager.ts` methods | `project_gather_complete()` and related removed; marker writes moved to CalypsoCore |

## What Survives in `src/core/workflows/`

Only type re-exports:
- `types.ts` — re-exports `WorkflowSummary`, `TransitionResult` from bridge
- `index.ts` — re-exports from `types.ts`

## Dotfile Markers Still In Use (Legacy Guards)

These are still written to the project workspace AND checked by non-DAG code:

| Marker | Written by | Read by |
|--------|-----------|---------|
| `.cohort` | `ProjectManager.project_gather()` | `CohortProfiler`, `CalypsoCore.workflow_nextStep()` guard |
| `.harmonized` | `ProjectManager.project_harmonize()` | `CalypsoCore.workflow_nextStep()` guard |
| `.local_pass` | `Shell.ts` (python train.py hook) | `Shell.ts` (federation readiness), `CalypsoCore` |
| `.federated` | `FederationOrchestrator` | `CalypsoCore.workflow_nextStep()` |

## Logical Next Steps

### Near-term: Eliminate Dual-Write
Migrate the dotfile marker consumers to read from session tree instead:
1. `Shell.ts:659` — checks `.local_pass` for federation readiness → should check session tree `train` artifact
2. `Shell.ts:465` — writes `.local_pass` → already dual-writing to session tree, remove dotfile write
3. `CalypsoCore.ts:719,755,1141` — guards that check `.harmonized`, `.local_pass`, `.federated` → use `position_resolve()`
4. `ProjectManager.ts:157,253` — writes `.cohort`, `.harmonized` → already dual-writing, remove dotfile writes
5. `CohortProfiler` — reads `.cohort` → check session tree `gather` artifact

### Medium-term: SessionStore Integration
The `SessionStore` (`src/dag/store/SessionStore.ts`) provides an async API with fingerprinting
and metadata. Currently the bridge uses raw VFS writes. Future: have `sessionArtifact_write()`
go through `SessionStore.artifact_write()` for automatic fingerprinting and parent-chain
validation.

### Medium-term: Fine-Grained Federation Tracking
Currently all 8 federation sub-stages alias to `federate-brief` artifact. Future: each
federation step writes its own artifact at its topology-aware path (e.g.
`train/federate-brief/federate-transcompile/data/federate-transcompile.json`).

## Test & Build Commands

```bash
npx vitest run                    # 323 tests, all pass
npm run build                     # tsc + manifest copy + knowledge bundle
node scripts/oracle-runner.mjs    # FedML smoke oracle (26 steps, topology-aware assertions)
npx tsc --noEmit                  # type check only
```

## Oracle

`tests/oracle/fedml-smoke.oracle.json` — reflexive NL testing where Calypso tests herself.
Uses `${session}` variable (resolved via `core.session_getPath()` in `scripts/oracle-runner.mjs`).
Assertions use topology-aware paths:

```
${session}/gather/data/gather.json
${session}/gather/harmonize/data/harmonize.json
${session}/gather/harmonize/code/data/code.json
${session}/gather/harmonize/code/train/data/train.json
${session}/gather/harmonize/code/train/federate-brief/data/federate-brief.json
```
