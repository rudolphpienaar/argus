# ARGUS Engineering Plan: The IAS Purity Refactor (Complete)

**Objective:** Transform `CalypsoCore` into a pure, domain-agnostic execution kernel and dissolve the `FederationOrchestrator` pattern. (COMPLETED v11.0.5)

---

# ARGUS Engineering Plan: Early Pipeline Gate Hardening

**Objective:** Refactor the early FedML pipeline to include explicit "Readiness" and "Collection" gates, using structural plugins to materialize causal checkpoints.

## 1. Manifest Redesign
**Goal:** Implement the dual-gate convergence model in `fedml.manifest.yaml`.

- [ ] **Update `fedml.manifest.yaml`**:
    - [ ] Create `join_ml-readiness-gather` stage (consumes `gather` and `ml-readiness`).
    - [ ] Create `gather-gate` structural stage (consumes `join_ml-readiness-gather`).
    - [ ] Create `join_collect_gather-gate` stage (consumes `gather-gate` and `collect`).
    - [ ] Update `collect` to consume `gather-gate`.
    - [ ] Update `pre_harmonize` to consume `join_collect_gather-gate`.
- [ ] **Verify**:
    - [ ] Run `make test` to ensure manifest parses and handlers exist.

## 2. Documentation Update
**Goal:** Align `FEDML.md` with the new physical materialization tree.

- [ ] **Update `FEDML.md`**:
    - [ ] Add the new stages to the topology map.
    - [ ] Describe the artifact content and directory shape for `gather-gate`.

## 3. Plugin Implementation
**Goal:** Materialize the logic for the new structural gates.

- [ ] **Create `src/plugins/gather-gate.ts`**:
    - [ ] Implement causal copy of gather output to gate output.
- [ ] **Verify Plugin Boundary**:
    - [ ] Run `npm run check:boundaries`.

## 4. Full Pipeline Verification
**Goal:** Ensure the end-to-end ORACLE walks pass with the new topology.

- [ ] **Run ORACLE Suites**:
    - [ ] Verify `fedml-linear-walk.oracle.json`.
    - [ ] Verify `generated-fedml.oracle.json`.

---

## Validation Strategy
- **RPN Compliance:** Use `object_method` naming in new plugins.
- **Merkle Integrity:** Ensure new stages correctly anchor fingerprints.
- **Strict Typing:** No `any` types in new plugin code.
