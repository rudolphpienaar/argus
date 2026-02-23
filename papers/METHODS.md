# METHODS: Measuring Agentic Context Drift Under Tethered vs Untethered Runtime Semantics

## Abstract

This document defines an experimental method to quantify context drift in a
manifest-driven LLM workflow runtime by comparing two execution postures:
artifact-tethered control flow (current ARGUS/Calypso architecture) and
artifact-untethered control flow (experimental). The aim is not to prove that
LLMs fail in general. The aim is to characterize where and how failure emerges
when controller decisions are no longer constrained by materialized evidence.

The key design requirement is isolation of the independent variable. We should
not compare two different products. We should compare the same runtime, same
manifests, same plugin surface, and same user prompts, while changing only
whether state progression and command admissibility are anchored to materialized
artifacts. The output should be publication-quality drift metrics, not anecdotes.

## 1. Research Question and Hypothesis

### 1.1 Question

How much does stage/context correctness degrade when Calypso no longer derives
workflow truth from materialized artifact state?

### 1.2 Primary Hypothesis

Untethered execution will show significantly higher context drift than tethered
execution across identical manifest scenarios, especially under re-entry and
branching patterns (re-search, re-gather, rename branch, out-of-order commands).

### 1.3 Secondary Hypotheses

1. Drift increase is superlinear with scenario complexity.
2. Drift is most visible after upstream mutation events that should invalidate
   downstream assumptions.
3. Untethered systems will accept more semantically invalid transitions that a
   tethered system blocks (`BLOCKED_STALE`, stage mismatch, prerequisite miss).

## 2. Conceptual Model

```text
┌───────────────────────────────┐
│ Human Command Stream          │
└───────────────┬───────────────┘
                │
                v
┌──────────────────────────────────────────────────────────────┐
│ Calypso Intent + Workflow Dispatch                          │
│  - routing/intent resolution                                │
│  - stage command admissibility                              │
└───────────────┬───────────────────────────────┬──────────────┘
                │                               │
     TETHERED   │                               │   UNTETHERED
                v                               v
┌───────────────────────────────┐   ┌───────────────────────────────┐
│ Stage truth from artifacts    │   │ Stage truth from memory/state │
│ + Merkle/staleness gating     │   │ (artifact checks bypassed)    │
└───────────────┬───────────────┘   └───────────────┬───────────────┘
                │                                   │
                └───────────────┬───────────────────┘
                                v
                    Drift Metrics + Outcome Traces
```

## 3. Current Tether Points in Code

These seams currently enforce artifact-grounded behavior and therefore define
where experimental untethering can be introduced.

1. Stage resolution and fast verification:
   `src/dag/bridge/WorkflowSession.ts` (`verify_fast`, stage synchronization).
2. Manifest topology and completion/staleness resolution:
   `src/dag/bridge/WorkflowAdapter.ts` (`position_resolve`, artifact reads).
3. Artifact envelopes and stage-path materialization:
   `src/dag/store/SessionStore.ts`, `src/dag/store/types.ts`.
4. Merkle fingerprinting and parent-chain checks:
   `src/lcarslm/MerkleEngine.ts`, `src/dag/fingerprint/*`.
5. Runtime dispatch and stale gating:
   `src/lcarslm/CalypsoCore.ts` (`workflow_dispatch`, `workflow_execute`,
   `BLOCKED_STALE` decision paths).
6. Command-stage coupling and active-stage routing:
   `src/lcarslm/routing/IntentParser.ts`.

## 4. Experimental Arms

## 4.1 Arm A: Tethered (Control)

Use current production semantics:
1. Stage progression determined from materialized artifacts.
2. Staleness checks enforced.
3. Workflow command admissibility constrained by active manifest stage.
4. Plugin outputs wrapped into artifact envelopes and consumed by resolver.

## 4.2 Arm B: Untethered-L1 (Read Untether)

Proposed minimal experimental intervention:
1. Keep plugin execution and artifact writes unchanged.
2. Bypass artifact-derived stage truth in resolver read paths.
3. Use in-memory/session pointer as the primary stage truth.
4. Preserve logging of artifact state for post-hoc ground-truth scoring.

Rationale: This isolates "controller untethering" without destroying normal I/O.

## 4.3 Arm C: Untethered-L2 (Read + Gate Untether)

Further intervention:
1. Same as L1.
2. Disable stale/prerequisite enforcement gates that depend on artifact lineage.
3. Allow transition acceptance based on controller belief only.

Rationale: Stress the exact claim that drift emerges when guardrails are absent.

## 4.4 Arm D: Full Untether (Optional, Later)

1. Do not consume artifact state for progression or gating.
2. Optionally reduce artifact writes to non-authoritative telemetry only.

Rationale: Useful as an upper-bound drift condition, but less realistic.

## 5. Scenario Matrix (Independent Stressors)

All arms should execute the same scenario catalog.

1. Linear happy path:
   `search -> gather -> rename(optional) -> harmonize -> code -> train -> federate*`.
2. Re-entry mutation:
   late `search` after downstream completion.
3. Re-gather branch:
   add/replace dataset after harmonize.
4. Rename branch:
   rename before/after gather, then continue.
5. Out-of-order prompts:
   early `harmonize`/`train`/`dispatch` attempts before prerequisites.
6. Ambiguous language commands:
   stage verbs embedded in natural language (e.g., "rename this as ...").
7. Confirmation-heavy branch jumps:
   repeated approval/continue prompts across stages.

## 6. Drift Metrics

## 6.1 Primary Endpoints

1. Stage Misalignment Rate:
   fraction of commands executed against a stage that differs from artifact
   truth at decision time.
2. Invalid Transition Acceptance:
   count of transitions accepted despite missing or stale prerequisites.
3. Stale-Bypass Incidence:
   count of downstream actions accepted when parent fingerprints changed.

## 6.2 Secondary Endpoints

1. Recovery Latency:
   turns required to recover to a valid stage after drift.
2. False Progress Claims:
   responses indicating completion without matching artifact evidence.
3. Path Incoherence Events:
   writes into stage paths inconsistent with manifest topology.

## 6.3 Session-Level Summary Score

Define a weighted drift index per run:

```text
DriftIndex =
  w1 * StageMisalignmentRate
+ w2 * InvalidTransitionAcceptance
+ w3 * StaleBypassIncidence
+ w4 * FalseProgressClaims
```

Weights should be fixed before data collection.

## 7. Instrumentation Plan

Instrumentation must be identical across arms.

1. Decision trace log:
   command, intent resolution, active stage belief, executed stage, gate result.
2. Artifact truth snapshot:
   resolver-visible completion/staleness state from artifact tree at each turn.
3. Outcome trace:
   status code, action list, materialized paths, stage transitions.
4. Run metadata:
   arm, manifest ID, scenario ID, seed, model/provider config, timestamp.

Suggested output layout:

```text
experiments/
└── drift-study/
    ├── runs/
    │   └── <run-id>/
    │       ├── meta.json
    │       ├── transcript.jsonl
    │       ├── decisions.jsonl
    │       ├── artifact-truth.jsonl
    │       └── metrics.json
    └── aggregate/
        ├── summary.csv
        └── stats.json
```

## 8. Analysis Plan

1. Compare each untether arm vs control for each primary metric.
2. Report effect sizes, not only p-values.
3. Stratify by scenario complexity.
4. Plot drift accumulation over turn index.
5. Include per-scenario confusion matrix:
   intended stage vs executed stage vs artifact-truth stage.

## 9. Validity and Controls

1. Keep prompts fixed across arms.
2. Keep plugins/manifests fixed across arms.
3. Keep randomness controlled (seed where possible).
4. Do not co-mingle runtime bugfixes with arm differences.
5. Preserve artifact logging in untether arms to maintain objective scoring.

## 10. Proposed Phased Implementation Roadmap

This section is intentionally implementation-oriented, but still pre-code.

## Phase 0: Protocol Lock

1. Freeze metric definitions and scenario catalog.
2. Freeze manifests used for experimental runs.
3. Define run metadata schema.

## Phase 1: Arm Abstraction

1. Introduce runtime mode concept for resolver/gating posture.
2. Ensure mode only changes read/gate semantics, not plugin writes.
3. Add explicit mode annotation to all run artifacts.

## Phase 2: Decision Tracing

1. Add structured hooks at intent resolution, stage selection, and gate checks.
2. Add artifact-truth snapshot on every command turn.

## Phase 3: Untether-L1

1. Route stage truth from pointer/memory path in experimental mode.
2. Keep artifact writes active for scoring.

## Phase 4: Untether-L2

1. Disable stale/prereq gating only in experimental mode.
2. Keep all traces identical for comparability.

## Phase 5: Batch Runner

1. Execute full scenario matrix across all arms.
2. Produce per-run metrics and aggregate summary tables.

## 11. Why This Is Scientifically Strong

The method avoids a weak comparison between "one architecture vs another
architecture." Instead, it isolates one causal lever: whether controller
decisions are grounded in materialized truth. Because artifacts are still
recorded in untether conditions, drift can be measured objectively against a
constant ground truth.

This makes the paper claim falsifiable:
if untethered arms do not drift more than tethered control under equivalent
stress scenarios, the theory is wrong. If they do, the result supports
data-state materialization as a structural defense, not a stylistic preference.

