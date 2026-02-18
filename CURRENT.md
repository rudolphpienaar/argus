# CURRENT STATE — 2026-02-17

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
3. **Generic Dispatch & Handlers**: `CalypsoCore` now uses a generic `workflow_execute`
   that routes commands to a `HANDLER_REGISTRY` based on the `handler` field in the manifest.
   The hardcoded switch statement in `workflow_dispatch` has been removed.
4. **Scaffolding Generalization**: `workflow_proceed` now uses the active `workflowId` from
   the adapter to decide which project populator to use, removing the need for persona-specific
   wrapper methods.
5. **Type Safety**: Updated `CalypsoAction` in `src/lcarslm/types.ts` to allow arbitrary
   string workflow IDs, supporting a truly open manifest system.

### Bug Fix: VFS POSIX Compliance
Fixed two regression in `VirtualFileSystem.ts`:
- `node_write` now correctly throws an error if the parent directory does not exist (matching POSIX).
- `node_invalidate` no longer clears content for files without a `contentGenerator`, preventing data loss for static files.

## What's Next

**Goal: Context-Aware Workflow Session.**
To solve the command ambiguity and "flailing" observed during granular manifest walks, we are introducing a `WorkflowSession` context. This moves the system from "Global Command Mapping" to "Contextual Routing."

1. **Implement `WorkflowSession`**: A runtime singleton/manager that tracks the `currentStage` and synchronizes with the VFS artifact trail.
2. **Contextual Priority**: Update `CalypsoCore.workflow_execute` to prioritize the session's active stage for command matching.
3. **Safety Gating**: Implement logic to detect and warn on "Phase Jumps" (out-of-context commands).
4. **Finalize Dynamic Oracle Generation**: Once routing is stable, finalize the tool to automatically generate and verify linear walks for any persona.

## Current Code State

- **317 tests pass** across 12 test files.
- **Oracle passes** (6 scenarios).
- **Build clean** — `tsc --noEmit` passes.

## Test & Build Commands

```bash
npx vitest run                    # 317 tests
npm run build                     # tsc + manifest copy
node scripts/oracle-runner.mjs    # Oracle smoke test
npx tsc --noEmit                  # Type check
```
