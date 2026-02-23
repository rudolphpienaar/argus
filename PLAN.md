# ARGUS Engineering Plan: The IAS Purity Refactor (Complete)

**Objective:** Transform `CalypsoCore` into a pure, domain-agnostic execution kernel and dissolve the `FederationOrchestrator` pattern. (COMPLETED v11.0.5)

---

# ARGUS Engineering Plan: Early Pipeline Gate Hardening (Complete)

**Objective:** Refactor the early FedML pipeline to include explicit "Readiness" and "Collection" gates, using structural plugins to materialize causal checkpoints. (COMPLETED v11.0.8)

## 1. Manifest Redesign
**Goal:** Implement the dual-gate convergence model in `fedml.manifest.yaml`.

- [x] **Update `fedml.manifest.yaml`**:
    - [x] Create `join_ml-readiness-gather` stage (consumes `gather` and `ml-readiness`).
    - [x] Create `gather-gate` structural stage (consumes `join_ml-readiness-gather`).
    - [x] Create `join_collect_gather-gate` stage (consumes `gather-gate` and `collect`).
    - [x] Update `collect` to consume `gather-gate`.
    - [x] Update `pre_harmonize` to consume `join_collect_gather-gate`.
- [x] **Verify**:
    - [x] Run `make test` to ensure manifest parses and handlers exist.

## 2. Documentation Update
**Goal:** Align `FEDML.md` with the new physical materialization tree.

- [x] **Update `FEDML.md`**:
    - [x] Add the new stages to the topology map.
    - [x] Describe the artifact content and directory shape for `gather-gate`.

## 3. Plugin Implementation
**Goal:** Materialize the logic for the new structural gates.

- [x] **Create `src/plugins/gather-gate.ts`**:
    - [x] Implement causal copy of gather output to gate output.
- [x] **Verify Plugin Boundary**:
    - [x] Run `npm run check:boundaries`.

## 4. Full Pipeline Verification
**Goal:** Ensure the end-to-end ORACLE walks pass with the new topology.

- [x] **Run ORACLE Suites**:
    - [x] Verify `fedml-linear-walk.oracle.json`.
    - [x] Verify `generated-fedml.oracle.json`.

---

## Validation Strategy
- **RPN Compliance:** Use `object_method` naming in new plugins.
- **Merkle Integrity:** Ensure new stages correctly anchor fingerprints.
- **Strict Typing:** No `any` types in new plugin code.
