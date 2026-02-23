# ARGUS Project Plan & Handoff Manifest

## Current Architectural Status (v12.0 "No-Magic")

### 1. Causal Provenance & Viewport Portal
- **Topology:** Full migration to a manifest-driven, session-based DAG. All physical work occurs in `~/projects/<persona>/<sessionId>/provenance/<topology>/output/`.
- **Viewport:** Eliminated `scratch/` directory. The active viewport is a symbolic link named after the `stageId` (e.g., `search`, `gather`) living directly in the session root.
- **Shell Autonomy:** Restored. The shell "beams" the user into the logical viewport once per stage transition, but does not forcefully "sticky-trap" the CWD during normal turns.
- **Boundary Guard:** Implemented. The shell detects when a user `cd`s out of the scratch space and provides a reminder to return via `cd @`.

### 2. Search-Gather Collection Workflow
- **Search Collector:** The `search` stage now acts as a buffer. `add <id>` materializes an atomic `add-<id>.json` file in the search output.
- **Incremental Ledger:** `search.json` maintains a cumulative record of all queries in the session.
- **Flat Gather:** The `gather` plugin materializes datasets into dedicated subdirectories named after their IDs (e.g., `gather/ds-001/`), preserving native data structures.
- **No-Magic Materialization:** `gather` derives its work strictly from the physical `add-*.json` files in its input directory, ignoring the application Store.

---

## The Fundamental Failure: Boot Telemetry Handshake

Despite multiple refactoring passes, the **Initial System Boot Sequence** remains invisible or incorrectly sequenced in the CLI REPL.

### Technical Discrepancies:
1. **The Race Condition:** The `sys_*` milestones (Genesis, Merkle Calibration) are emitted during the initial connection/login phase. While the server is configured to `await calypso.boot()`, the CLI REPL often fails to render these events, or they arrive in a single "burst" after the handshake is already complete.
2. **Phase Bifurcation:** The `user_*` milestones (Manifest Load, VFS Scaffolding) correctly appear *after* persona selection, confirming that the telemetry bus is functional but the timing of the initial connection is still misaligned.
3. **CLI Rendering Conflict:** The interaction between Node.js `readline`, the cursor-overwrite logic, and the WebSocket stream has proved brittle. In-place status replacement works for the second phase but often stalls or clobbers the terminal during the first phase.

### Known Issues & Regressions:
- **Telemetry Silence:** System-level boot milestones are frequently missed by the CLI client.
- **UI Latency:** The initial VFS scaffolding and Merkle walk cause a significant "cold start" delay that is not yet successfully masked by the informative boot sequence.
- **Duplicate Logic:** Residual project-centric logic may still exist in older stages (Monitor/Post) that have not yet been refactored to the v12.0 "Flat Collection" model.

---

## Handoff Directives

1. **Stabilize Boot Sequence:** Resolve the race condition between the `CalypsoServer` boot-trigger and the `CalypsoRepl` telemetry subscription. Ensure `sys_genesis` is the first thing the user sees.
2. **Validate DAG Continuity:** Verify that the `workspace-commit` and `topological-join` handlers correctly preserve the "Flat Collection" structure as the user moves into `harmonize` and `code`.
3. **RPN Compliance:** Maintain the `object_method` naming convention and high-integrity JSDoc standards established in the v12.0 core.
4. **Shell Consistency:** Ensure the `logicalPwd` in the Shell remains perfectly synced with the physical `cwd` in the VFS to prevent link-to-self recursion.
