# CURRENT STATE — 2026-02-18

## What Just Happened (Chronological)

### Commit 1-3: Previously documented in v7.3.x history.

### Commit 4: v9.3.1 — Fully Manifest-Driven Persona Refactor (COMPLETED)
Achieved the goal of making personas fully manifest-driven. Adding a new persona now only
requires adding a `.manifest.yaml` file to `src/dag/manifests/`.

1. **Dynamic Manifest Registry**: Replaced hardcoded `MANIFEST_REGISTRY` in `WorkflowAdapter.ts`
   with a dynamic scanning mechanism that reads all `*.manifest.yaml` files from the
   manifests directory.
2. **Generic Completion Mapping**: Completion aliases (`completes_with`) are now read
   directly from the manifest YAML. The `fedmlMapper_create` and `chrisMapper_create`
   factories have been deleted in favor of a generic `manifestMapper_create`.
3. **Generic Dispatch & Handlers**: `CalypsoCore.workflow_execute` now dispatches via each
   stage's manifest-defined `handler` into `PluginHost`, replacing persona-specific dispatch.
4. **Workflow Context Routing**: `WorkflowSession` now resolves commands in context using the
   active stage first, with explicit phase-jump confirmations when users issue out-of-context
   commands.
5. **Type Safety**: Updated `CalypsoAction` in `src/lcarslm/types.ts` to allow arbitrary
   string workflow IDs, supporting a truly open manifest system.

### Bug Fix: VFS POSIX Compliance
Fixed two regression in `VirtualFileSystem.ts`:
- `node_write` now correctly throws an error if the parent directory does not exist (matching POSIX).
- `node_invalidate` no longer clears content for files without a `contentGenerator`, preventing data loss for static files.

## What's Next

**Goal: Runtime `_join_*` Materialization Integration.**
The objective is to move from primary-parent-only runtime nesting to explicit topological join
materialization for multi-parent DAG convergence, while preserving backward compatibility.

### Phase 0 — Baseline and Guardrails (COMPLETE)
1. Bridge fixture drift fixed; all bridge tests now align with fingerprint contract.
2. Full unit baseline restored: `317/317` tests passing.
3. ORACLE baseline confirmed: `8/8` scenarios passing.

### Phase 1 — Integration Scaffolding
1. Introduced optional runtime routing through `SessionStore` + `VfsBackend` in `MerkleEngine`
   via `runtimeMode: 'store'`.
2. Initially preserved default behavior (`runtimeMode: 'legacy'`) while scaffolding landed.
3. Added join-runtime toggle scaffolding (`joinMaterializationEnabled` / `ARGUS_RUNTIME_JOIN_MATERIALIZE`)
   with default OFF; Phase 1 keeps primary-parent write paths even when the toggle is enabled.

### Phase 2 — Join-Node Write Path
1. Enable join-node insertion for multi-parent stage materialization in runtime:
   - create `_join_<parents>/data/join.json`
   - create parent input references under join `data/`
   - nest downstream stage artifacts under the join node
   - status: implemented in `MerkleEngine` when `runtimeMode='store'` and join toggle is enabled
2. Preserve fingerprint chain semantics across join artifacts and downstream children.

### Phase 3 — Read/Resolve Compatibility
1. Make completion and staleness reads tolerant to both layouts:
   - legacy primary-parent sessions
   - new join-materialized sessions
   - status: implemented for transition gating + session fast-verify using fingerprint discovery
2. Ensure `WorkflowSession.verify_fast()` and transition checks remain correct under both trees.
   - status: implemented
3. Emit `BLOCKED_STALE` explicitly where stale-data gating is surfaced.
   - status: implemented (`CalypsoCore` returns `BLOCKED_STALE` on stale prerequisite blocks)

### Phase 4 — Validation and Flip
1. Expand bridge/store/oracle assertions to include explicit join runtime expectations.
2. Re-run full quality gates: unit tests, ORACLE, build, typecheck.
3. Flip join runtime toggle to default-on only after all gates are green.
   - status: implemented (`store+join` is now default runtime posture)
4. Keep compatibility reader for historical sessions (no migration rewrite required).
   - status: implemented (legacy read compatibility retained; legacy write path deprecated)

### Risks and Controls
1. **Routing regressions** (stage resolution drift): controlled by dual-layout read support + oracle walks.
2. **Path assertion breakage** in tests: controlled by staged test updates before default flip.
3. **Session compatibility**: controlled by non-destructive backward-compatible reader behavior.

### Acceptance Criteria
1. Join nodes are physically materialized for multi-parent convergence in live runtime.
2. `WorkflowAdapter.position_resolve()` returns identical logical stage progression across both layouts.
3. `BLOCKED_STALE` is emitted for stale-gated commands where applicable.
4. `328/328` unit tests and `8/8` ORACLE scenarios remain green post-flip.

## Current Code State

- **Unit tests**: `328 passed / 0 failed` across 13 test files.
- **ORACLE**: `8 scenarios passed` (including generated FedML/ChRIS and merkle-staleness scenarios).
- **Build/typecheck**: verified green after default `store+join` flip.

## Test & Build Commands

```bash
npx vitest run                    # currently: 328 passed / 0 failed
npm run build                     # tsc + manifest copy
node scripts/oracle-runner.mjs    # currently: 8 scenarios pass
npx tsc --noEmit                  # Type check
```
