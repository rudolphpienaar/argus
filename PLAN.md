# ARGUS Engineering Plan: The IAS Purity Refactor (Complete)

**Objective:** Transform `CalypsoCore` into a pure, domain-agnostic execution kernel. (COMPLETED v11.0.5)

---

# ARGUS Engineering Plan: Early Pipeline Gate Hardening (Complete)

**Objective:** Refactor the early FedML pipeline to include explicit "Readiness" and "Collection" gates. (COMPLETED v11.0.8)

---

# ARGUS Engineering Plan: God-Object Modularization (Complete)

**Objective:** Decompose oversized modules and methods. (COMPLETED v11.0.9)

---

# ARGUS Engineering Plan: Intent-Guard Hardening (Complete)

**Objective:** Implement toggleable "Intent Guardrail" system. (COMPLETED v11.0.16)

---

# ARGUS Engineering Plan: CNS Consolidation & Null-Hypothesis Mode (Complete)

**Objective:** Colocate all "Brain" modules into a single `kernel/` directory to create a centralized, auditable Central Nervous System (CNS) and implement a "Null Hypothesis" mode for quantitative drift experiments. (COMPLETED v12.0.2)

- [x] **Establish `src/lcarslm/kernel/`**:
    - [x] Move AI modules to consolidated CNS dirtree.
- [x] **The CalypsoKernel Facade**:
    - [x] Implement `CalypsoKernel` with `STRICT`, `EXPERIMENTAL`, and `NULL_HYPOTHESIS` modes.
- [x] **Simplified Core Integration**:
    - [x] Refactor `CalypsoCore` to delegate intelligence resolution to the Kernel facade.
- [x] **Verification**:
    - [x] All 427 unit tests and 9 ORACLE scenarios green.
    - [x] `NullHypothesis.test.ts` verifies structural bypass logic.
