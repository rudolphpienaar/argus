# FEDML Pipeline (Dual-Gate Provenance Contract)

## Abstract
This document specifies the FEDML pipeline contract for a readiness-first workflow in which raw cohort acquisition is cleanly separated from machine-learning feasibility checks and optional data reorganization. The central design goal is to prevent compute waste and scientific ambiguity by introducing an explicit **Readiness Gate** and **Collection Gate** model.

The contract formalizes a strict provenance layout model using structural **Gate** stages to lock upstream output. Every stage writes a deterministic `input/`, `meta/`, and `output/` triad under the session provenance tree. Structural and non-root optional nodes remain lineage-visible but path-transparent for downstream nesting.

## Introduction: Why This Contract Changed
The previous FEDML documentation reflected a single-join model. Experience showed that this model lacked a formal "Commit" step for the raw cohort before analysis and reorganization began. Without an explicit gate, the causal link between "what was gathered" and "what was analyzed" remained partly implicit.

The dual-gate contract resolves that pressure by introducing a structural `gather-gate` immediately after readiness checks. This gate functions as a **Causal Lock** that materializes the gathered cohort into a new stage-scoped path, providing a stable, immutable substrate for either optional reorganization (`collect`) or standardization (`harmonize`).

## Full DAG (Start to End)
The following figure shows the complete FEDML pipeline with the dual-gate convergence model.

```text
search (optional root)
  |
gather
  | \
  |  ml-readiness (optional gate)
  | /
join_ml-readiness-gather (structural join)
  |
gather-gate (structural commit)
  | \
  |  collect (optional reorganization)
  | /
join_collect_gather-gate (structural join)
  |
pre_harmonize (structural source resolver)
  |
harmonize
  |
code
  |
train
  |
federate-*
```

## Provenance Semantics
### Session Root
All stage evidence is materialized beneath:

```text
~/projects/<PERSONA>/<SESSION_ID>/provenance/
```

A stage directory is always represented as:

```text
<stage>/
├── input/
├── meta/
└── output/
```

### Path Transparency Rules
The lineage engine preserves two invariants for downstream nesting:

1. Structural stages are path-transparent.
2. Non-root optional stages are path-transparent.

This means optional or structural branches are still recorded in `meta/` artifacts and sentinels, but descendants resolve under the nearest user-facing required ancestor chain. This is what prevents path explosion while keeping provenance explicit.

## Stage Contract (Gather to Harmonize)
### 1) `gather`
Handler: `src/plugins/gather.ts`

`gather` materializes raw cohort directories exactly as cohort-specific payloads.

### 2) `ml-readiness` (optional gate)
Handler: `src/plugins/ml-readiness.ts`

Evaluates whether the assembled cohort is scientifically coherent. Emits pass/fail rationale.

### 3) `join_ml-readiness-gather` (structural)
Handler: `src/plugins/topological-join.ts`

Converges the raw acquisition and the readiness result.

### 4) `gather-gate` (structural)
Handler: `src/plugins/gather-gate.ts`

Functions as a causal lock. It copies the `gather` output to its own `output/` directory, providing a stable Merkle-anchored version of the cohort after the readiness decision is made.

### 5) `collect` (optional reorganization)
Handler: `src/plugins/collect.ts`

Reorganizes the gated cohort into a normalized training layout.

### 6) `join_collect_gather-gate` and `pre_harmonize` (structural)
Handlers:
- `src/plugins/topological-join.ts`
- `src/plugins/pre-harmonize.ts`

Converges the gated cohort and the optional collection. `pre_harmonize` selects `collect` if present, otherwise the gated `gather` output.

### 7) `harmonize`
Handler: `src/plugins/harmonize.ts`

Standardizes site heterogeneity using the gated/collected substrate.

## Execution Paths
### Minimal Path (skip both optional branches)

```text
search -> gather -> join_ml-readiness-gather -> gather-gate -> join_collect_gather-gate -> pre_harmonize -> harmonize ...
```

### Readiness Path (run `ml-readiness`, skip `collect`)

```text
search -> gather -> ml-readiness -> join_ml-readiness-gather -> gather-gate -> join_collect_gather-gate -> pre_harmonize -> harmonize ...
```

### Full Branch Path (run `ml-readiness` and `collect`)

```text
search -> gather -> ml-readiness -> join_ml-readiness-gather -> gather-gate -> collect -> join_collect_gather-gate -> pre_harmonize -> harmonize ...
```

## End-State Example (Condensed)

```text
~/projects/<PERSONA>/<SESSION_ID>/
├── provenance/
│   └── search/
│       └── gather/
│           ├── output/                       # raw acquisition
│           ├── ml-readiness/                 # optional
│           ├── join_ml-readiness-gather/     # structural
│           ├── gather-gate/
│           │   └── output/                   # causal commit of gather
│           ├── collect/                      # optional
│           ├── join_collect_gather-gate/     # structural
│           ├── pre_harmonize/                # structural
│           └── harmonize/
└── <stage>@ symlinks
```

## Conclusion
The dual-gate FEDML contract formalizes the "Commitment" phase of scientific research. By using structural gate plugins to lock upstream data, we ensure that every step in the pipeline—from feasibility checks to reorganization—is performed against a stable, cryptographically-anchored substrate.

---
_Last updated: 2026-02-23 (dual-gate convergence contract)_
