# ARGUS Engineering Plan: The IAS Purity Refactor

**Objective:** Transform `CalypsoCore` into a pure, domain-agnostic execution kernel and dissolve the `FederationOrchestrator` pattern. The system must adhere strictly to the **Intent-Action-State (IAS)** architecture, where the core logic resides in **Plugins** and **Manifests**, not the kernel.

## 1. IntentParser & Compound Commands
**Goal:** Enable `IntentParser` to resolve multi-word commands (e.g., `python train.py`, `show container`) from the manifest without kernel hacks.

- [x] **Update `IntentParser.ts`**:
    - [x] Modify `deterministicIntent_resolve` to match exact multi-word phrases from `WorkflowAdapter.declaredCommands`.
    - [x] Remove the single-word regex restriction in `workflowCommands_resolve`.
- [x] **Verify**:
    - [x] Add unit test case for `python train.py` resolution.
    - [x] Ensure existing single-word commands still resolve correctly.

## 2. Purge Domain Logic from CalypsoCore
**Goal:** Remove hardcoded command handling (the `python` hack) and "God Object" responsibilities from `CalypsoCore.ts`.

- [x] **Refactor `CalypsoCore.ts`**:
    - [x] Remove `shell_handle` special case for `python`.
    - [x] Verify `train` plugin executes `python` via shell and handles artifact materialization.
- [x] **Extract System Commands**:
    - [x] Create `src/lcarslm/routing/SystemCommandRegistry.ts`.
    - [x] Move `/reset`, `/state`, `/snapshot`, `/version`, `/key`, `/session`, `/dag`, `/workflows`, `/help` handlers to the registry.
    - [x] Update `CalypsoCore` to delegate to this registry.
- [x] **Extract Guidance & Confirmation**:
    - [x] Create `src/lcarslm/routing/WorkflowController.ts`.
    - [x] Move `guidance_handle` and `confirmation_dispatch` to the controller.
    - [x] Update `CalypsoCore` to delegate to this controller.
- [x] **Verify**:
    - [x] Run ORACLE `train` walk to ensure `python train.py` still completes the stage and produces artifacts.

## 3. Federation Simulation Plugin
**Goal:** Replace the hardcoded `setTimeout` simulation in `phases.ts` with a proper plugin-driven telemetry stream.

- [x] **Create `src/plugins/federation-simulator.ts`**:
    - [x] Implement `plugin_execute` to run the build/distribution simulation.
    - [x] Emit `telemetry` events for build steps and node handshakes.
- [x] **Update `phases.ts` (UI)**:
    - [x] Remove simulation logic.
    - [x] Update to listen for telemetry events and render state (ProgressBar, Icons).
- [x] **Update Manifest**:
    - [x] Ensure `federate` stage uses the `federation-simulator` handler.
- [x] **Verify**:
    - [x] Run unit tests and boundary checks (all green).

## 4. Boot & Session Orchestration (Cleanup)
**Goal:** Isolate boot and session management from the core kernel.

- [ ] **Create `src/lcarslm/BootOrchestrator.ts`**:
    - [ ] Move `boot()` and `workflow_set()` logic.
- [ ] **Create `src/lcarslm/SessionManager.ts`**:
    - [ ] Move `session_realign()` and related session logic.

---

## Validation Strategy
- **ORACLE Suites:** Run `make test-oracle` after each major refactor step.
- **Strict Typing:** Ensure no `any` types are introduced during refactoring.
- **Boundary Checks:** Run `npm run check:boundaries` to ensure plugins do not import core logic.

---

## Previous Context (v12.0 "No-Magic")
*Retained for reference regarding Viewport/Shell behavior.*

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
