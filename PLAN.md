# ARGUS Engineering Plan: The IAS Purity Refactor (Complete)

**Objective:** Transform `CalypsoCore` into a pure, domain-agnostic execution kernel and dissolve the `FederationOrchestrator` pattern. (COMPLETED v11.0.5)

---

# ARGUS Engineering Plan: Early Pipeline Gate Hardening (Complete)

**Objective:** Refactor the early FedML pipeline to include explicit "Readiness" and "Collection" gates, using structural plugins to materialize causal checkpoints. (COMPLETED v11.0.8)

---

# ARGUS Engineering Plan: God-Object Modularization (Complete)

**Objective:** Decompose oversized modules and methods identified in the v11.0.8 audit to ensure long-term maintainability and single-responsibility compliance. (COMPLETED v11.0.9)

## 1. Workflow Visualization Extraction
**Goal:** Move `dag_render` logic out of `WorkflowAdapter` into a dedicated visualization engine.

- [x] **Create `src/dag/visualizer/DagRenderer.ts`**:
    - [x] Implement `DagRenderer` class.
    - [x] Move `Tree`, `Compact`, and `Box` rendering logic.
- [x] **Update `WorkflowAdapter.ts`**:
    - [x] Delegate `dag_render` to the new engine.
- [x] **Verify**:
    - [x] Run `bridge.test.ts` to ensure DAG visuals are identical.

## 2. Intent Router Separation
**Goal:** Split `IntentParser` into deterministic and probabilistic modules.

- [x] **Create `src/lcarslm/routing/FastPathRouter.ts`**:
    - [x] Move regex and exact-phrase matching logic.
- [x] **Create `src/lcarslm/routing/LLMIntentCompiler.ts`**:
    - [x] Move prompt construction and JSON result parsing.
- [x] **Update `IntentParser.ts`**:
    - [x] Delegate resolution to the new components.
- [x] **Verify**:
    - [x] Run `IntentParser.test.ts` and `IntentParser.compound.test.ts`.

## 3. Kernel Dependency Injection
**Goal:** Simplify the `CalypsoCore` constructor by using a Factory pattern.

- [x] **Create `src/lcarslm/CalypsoFactory.ts`**:
    - [x] Implement wiring logic for all kernel services.
- [x] **Update `CalypsoCore.ts`**:
    - [x] Simplify constructor using synchronous bag assembly.
- [x] **Verify**:
    - [x] Run `CalypsoCore.test.ts`.

## 4. Registry Hardening (S-Tier)
**Goal:** Refactor `SystemCommandRegistry` to use a disciplined enum-driven factory pattern.

- [x] **Define `SystemCommand` Enum**: Model all OS-level verbs.
- [x] **Decompose Handlers**: Move each registration into its own typed method in `SystemCommandHandlers`.
- [x] **Implement Factory**: Create `SystemCommandFactory` to loop across enums and dispatch to the registry.
- [x] **Verify**:
    - [x] Run `CalypsoCore.test.ts` (all green).

## 5. Manifest RAG Grounding
**Goal:** Fix conversational drift by providing the LLM with the full manifest context for the active stage.

- [x] **Update `StatusProvider.ts`**:
    - [x] Refactor `workflowContext_generate` to include exhaustive manifest metadata (instruction, commands, blueprint) for the active stage.
- [x] **Verify**:
    - [x] Run `CalypsoCore.test.ts`.

---

## Validation Strategy
- **Visual Parity:** Ensure DAG ASCII output remains unchanged.
- [x] **Regression Testing:** Full ORACLE suite run after each refactor.
- [x] **RPN Compliance:** Maintain naming standards in new classes.
