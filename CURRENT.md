# CURRENT STATE — 2026-02-23

## v12.0.0 — The Instrumented CNS (COMPLETED)

1.  **CNS Consolidation**: Relocated all intelligence modules to `src/lcarslm/kernel/` to create a centralized, auditable Central Nervous System.
2.  **CalypsoKernel Facade**: Implemented a unified mediator for intent resolution, encapsulating Guidance, FastPath, RAG, and LLM orchestration.
3.  **Null Hypothesis (Structural Bypass)**:
    -   Implemented `NULL_HYPOTHESIS` mode for quantitative drift experiments.
    -   Bypass logic intentionally disables Prompt RAG, Anaphora grounding, and FastPath interceptors.
    -   Enables researchers to observe the "Raw Light" of model non-determinism against a deterministic baseline.
4.  **Precedence of Truth**: Hardcoded the Interceptor Pattern into the CNS to ensure deterministic filters always precede probabilistic interpretation.
5.  **Validation status**:
    -   Unit tests: `425/425` passing.
    -   ORACLE scenarios: `9/9` passing.

## What Just Happened (Chronological)

### v11.0.5: IAS Purity Refactor
Achieved the absolute separation of Intent, Action, and State. Purged domain intelligence from the kernel and offloaded lifecycle policy to `BootOrchestrator` and `SessionManager`.

### v11.0.16: Intent Guard and Precedence Lock
Implemented the `IntentGuard` to prevent "Intent Theft" through vocabulary jailing and output validation. Enforced the "Precedence of Truth" mandate in the execution loop.

### v12.0.0: CNS Consolidation and Measurement Architecture
Moved from "Safe Architecture" to "Measurement Architecture." Centralized the brain and provided the structural bypasses required for scientific study of autonomous drift.

## What's Next

**Goal: Quantitative Drift Measurement Baseline.**
The objective is to utilize the v12.0.0 instrumentation to document the first "Hallucination Gap" metrics.

1.  **Baseline Generation**: Run the full ORACLE suite in `NULL_HYPOTHESIS` mode.
2.  **Drift Capture**: Document the specific stages where the naked model attempts to jump topology.
3.  **Safety Multiplier**: Calculate the mathematical reliability increase provided by the `STRICT` mode guardrails.

## Current Code State

- **Unit tests**: `425 passed / 0 failed`.
- **ORACLE**: `9 scenarios passed`.
- **Instrumentation**: `STRICT`, `EXPERIMENTAL`, `NULL_HYPOTHESIS` modes verified.

## Test & Build Commands

```bash
npx vitest run                    # currently: 425 passed / 0 failed
npm run build                     # tsc + manifest copy
node scripts/oracle-runner.mjs    # currently: 9 scenarios pass
npx tsc --noEmit                  # Type check
```
