# ARGUS Engineering Plan: The IAS Purity Refactor (Complete)

**Objective:** Transform `CalypsoCore` into a pure, domain-agnostic execution kernel. (COMPLETED v11.0.5)

---

# ARGUS Engineering Plan: Early Pipeline Gate Hardening (Complete)

**Objective:** Refactor the early FedML pipeline to include explicit "Readiness" and "Collection" gates. (COMPLETED v11.0.8)

---

# ARGUS Engineering Plan: God-Object Modularization (Complete)

**Objective:** Decompose oversized modules and methods. (COMPLETED v11.0.9)

---

# ARGUS Engineering Plan: Intent-Guard Hardening (The "Drift-Ready" Core)

**Objective:** Implement a fundamental, toggleable "Intent Guardrail" system to prevent hallucination-driven stage jumping and enable quantitative drift experiments.

## 1. The IntentGuard Module
**Goal:** Centralize vocabulary jailing and output validation.

- [ ] **Create `src/lcarslm/routing/IntentGuard.ts`**:
    - [ ] Implement `IntentGuard` class with `STRICT` and `EXPERIMENTAL` modes.
    - [ ] Implement `vocabulary_jail()`: Restrict LLM visibility to DAG-ready commands only.
    - [ ] Implement `intent_validate()`: Downgrade unauthorized intents to `conversational`.
- [ ] **Verify**:
    - [ ] Add `IntentGuard.test.ts` to verify mode-switching and filtering.

## 2. IntentParser Interceptor Refactor
**Goal:** Encapsulate precedence so it cannot be broken by code reordering.

- [ ] **Update `IntentParser.ts`**:
    - [ ] Hide `LLMIntentCompiler` behind a protected method.
    - [ ] Force `FastPathRouter` check before any LLM invocation.
    - [ ] Integrate `IntentGuard` into the compiler loop.
- [ ] **Verify**:
    - [ ] Ensure unit tests pass with `STRICT=true`.

## 3. Kernel Integration & Toggle
**Goal:** Expose guardrail mode as a first-class configuration.

- [ ] **Update `CalypsoCoreConfig`**:
    - [ ] Add `enableIntentGuardrails` flag.
- [ ] **Update `CalypsoFactory.ts`**:
    - [ ] Wire the flag to the `CALYPSO_STRICT` environment variable.
- [ ] **Verify**:
    - [ ] Run ORACLE tests in both modes to measure baseline drift.

## 4. Documentation & Style Hardening
**Goal:** Codify the "Precedence of Truth" mandate.

- [ ] **Update `TYPESCRIPT-STYLE-GUIDE.md`**:
    - [ ] Add "Architectural Precedence Mandate": Deterministic filters MUST precede probabilistic interpretation.
- [ ] **Update `docs/agentic-safety.adoc`**:
    - [ ] Formalize the `IntentGuard` as a core safety primitive.

---

## Validation Strategy
- **Path Assertion:** New tests to check `isModelResolved` status.
- **Zero-Shot Regression:** Run full ORACLE suite.
- **Experimental Baseline:** Document drift metrics with Guardrails OFF.
