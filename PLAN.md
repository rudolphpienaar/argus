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

# ARGUS Engineering Plan: CNS Consolidation & Null-Hypothesis Mode

**Objective:** Colocate all "Brain" modules into a single `kernel/` directory to create a centralized, auditable Central Nervous System (CNS) and implement a "Null Hypothesis" mode for quantitative drift experiments.

## 1. CNS Directory Structural Setup
**Goal:** Create the `src/lcarslm/kernel/` directory and relocate existing intelligence modules.

- [ ] **Establish `src/lcarslm/kernel/`**:
    - [ ] Move `engine.ts` -> `kernel/LCARSEngine.ts`.
    - [ ] Move `StatusProvider.ts` -> `kernel/StatusProvider.ts`.
    - [ ] Move `routing/IntentGuard.ts` -> `kernel/IntentGuard.ts`.
    - [ ] Move `routing/FastPathRouter.ts` -> `kernel/FastPathRouter.ts`.
    - [ ] Move `routing/LLMIntentCompiler.ts` -> `kernel/LLMIntentCompiler.ts`.
    - [ ] Move `routing/IntentParser.ts` -> `kernel/IntentParser.ts`.
- [ ] **Verify**:
    - [ ] Run `make test` to ensure imports are correctly updated.

## 2. The CalypsoKernel Facade
**Goal:** Implement a high-level CNS entry point that encapsulates the "Structural Bypass" logic.

- [ ] **Create `src/lcarslm/kernel/CalypsoKernel.ts`**:
    - [ ] Implement `CalypsoKernel` class.
    - [ ] Implement `OperationMode`: `STRICT`, `EXPERIMENTAL`, `NULL_HYPOTHESIS`.
    - [ ] Encapsulate the `IntentParser` and `LLMProvider` logic into a single `resolve()` method.
    - [ ] Add the "Structural Bypass" logic: in `NULL_HYPOTHESIS` mode, skip FastPath and RAG context injection.
- [ ] **Update `CalypsoFactory.ts`**:
    - [ ] Wire the `CalypsoKernel` as the primary intelligence mediator.

## 3. Simplified Core Integration
**Goal:** Strip residual intelligence orchestration from `CalypsoCore`.

- [ ] **Refactor `CalypsoCore.ts`**:
    - [ ] Delegate `command_execute` directly to `CalypsoKernel.resolve()`.
    - [ ] Remove separate calls to `IntentParser` and `LLMProvider`.
- [ ] **Verify**:
    - [ ] Run `CalypsoCore.test.ts`.

## 4. Null-Hypothesis Verification
**Goal:** Prove the "Zero-Bias" mode works without breaking the infrastructure.

- [ ] **Add `NullHypothesis.test.ts`**:
    - [ ] Verify that in `NULL_HYPOTHESIS` mode, the LLM is called with empty context and FastPath is bypassed.
- [ ] **Verify**:
    - [ ] Run ORACLE suites in `NULL_HYPOTHESIS` mode and document the baseline hallucination rate.

---

## Validation Strategy
- **Architectural Audit:** Verify all AI logic is contained within `src/lcarslm/kernel/`.
- **Zero-DOM Enforcement:** Ensure the CNS remains 100% browser-agnostic.
- **Regression Testing:** Ensure `STRICT` mode maintains the existing ORACLE success rate.
