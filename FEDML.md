# FEDML Pipeline (Readiness-First Provenance Contract)

## Abstract
This document specifies the FEDML pipeline contract for a readiness-first workflow in which raw cohort acquisition is cleanly separated from machine-learning feasibility checks and optional data reorganization. The central design goal is to prevent compute waste and scientific ambiguity by introducing an explicit `ml-readiness` gate immediately after `gather`, before any harmonization or code-generation work begins.

The contract also formalizes a strict provenance layout model. Every stage writes a deterministic `input/`, `meta/`, and `output/` triad under the session provenance tree. Structural and non-root optional nodes remain lineage-visible but path-transparent for downstream nesting. This keeps causal evidence complete while preserving stable consumer paths for harmonization and later federation stages.

## Introduction: Why This Contract Changed
The previous FEDML documentation reflected an earlier branch in which optional project-renaming occupied the only post-gather branch point. That model did not address a more important scientific failure mode: users could assemble mixed-task cohorts (classification + detection + segmentation) and continue toward training without a formal machine-learning feasibility decision.

In practice, that produced two kinds of drift. First, expensive downstream steps could run on ill-posed task mixtures where model objective, supervision shape, and evaluation semantics were not aligned. Second, provenance could remain technically valid while the experiment itself was weakly defined, which is a scientific quality failure even if the software path was deterministic.

The readiness-first contract resolves that pressure by moving feasibility analysis directly after `gather`, before optional reorganization. `collect` remains optional and does not replace feasibility; it only restructures already-accepted cohorts into a normalized training collection. The resulting architecture preserves user override flexibility while making experiment viability an explicit decision point in the causal chain.

## Full DAG (Start to End)
The following figure shows the complete FEDML pipeline with explicit branch and
join topology after `ml-readiness` and before `harmonize`.

```text
search (optional root)
  |
gather
  |
ml-readiness (optional gate)
  |\
  | \--> collect (optional reorganization)
  |         |
  +---------+
      |
join_gather_collect (structural; parents: ml-readiness + collect)
  |
pre_harmonize (structural source resolver; collect > gather)
  |
harmonize
  |
pre_code (structural)
  |
code
  |
pre_train (structural)
  |
train
  |
federate-brief
  |
federate-transcompile
  |
federate-containerize
  |
federate-publish-config
  |
federate-publish-execute
  |
federate-dispatch
  |
federate-execute
  |
federate-model-publish
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

### Optional Stage Meaning
In this contract, optional does not mean undefined behavior. It means the stage can be bypassed with explicit provenance. Skip behavior is expected to materialize a sentinel receipt so causal history records that the branch was declined rather than omitted accidentally.

## Stage Contract (Gather to Harmonize)
### 1) `gather`
Handler: `src/plugins/gather.ts`

`gather` materializes raw cohort directories exactly as cohort-specific payloads, with no global training objective assumptions.

```text
~/projects/<PERSONA>/<SESSION_ID>/provenance/search/gather/output/
├── .cohort
├── BCH_Chest_X-ray_Cohort/
│   ├── images/
│   └── labels.csv
├── MGH_COVID_Collection/
│   ├── images/
│   └── labels.csv
├── BIDMC_Pneumonia_Set/
│   ├── images/
│   └── annotations.json
└── BWH_Thoracic_Segments/
    ├── images/
    └── masks/
```

### 2) `ml-readiness` (optional gate, recommended)
Handler: `src/plugins/ml-readiness.ts`

`ml-readiness` evaluates whether the assembled cohort is scientifically coherent for a declared objective. It should classify task mix, inspect supervision availability, and fail fast on incompatible configurations unless explicitly overridden.

Expected output shape:

```text
~/projects/<PERSONA>/<SESSION_ID>/provenance/search/gather/ml-readiness/output/
├── ml-readiness.json
├── task-matrix.json
└── coverage-report.md
```

### 3) `collect` (optional reorganization)
Handler: `src/plugins/collect.ts`

`collect` does not decide whether a cohort is meaningful. It reorganizes already accepted data into a normalized collection layout suitable for downstream harmonization and model-specific preprocessing.

Expected output shape:

```text
~/projects/<PERSONA>/<SESSION_ID>/provenance/search/gather/collect/output/
├── collect.json
├── collection-manifest.json
├── cohorts/
│   ├── classification/
│   │   ├── BCH_Chest_X-ray_Cohort/
│   │   └── MGH_COVID_Collection/
│   ├── detection/
│   │   └── BIDMC_Pneumonia_Set/
│   └── segmentation/
│       └── BWH_Thoracic_Segments/
└── splits/
    ├── train/
    ├── validation/
    └── test/
```

### 4) `join_gather_collect` and `pre_harmonize` (structural)
Handlers:
- `src/plugins/topological-join.ts`
- `src/plugins/pre-harmonize.ts`

The join stage exposes both available parents as linked views. `pre_harmonize` then selects the authoritative upstream source with deterministic precedence:

1. `collect` if present
2. `gather` otherwise

This preserves a stable harmonization ingress without requiring downstream path changes.

### 5) `harmonize`
Handler: `src/plugins/harmonize.ts`

Because optional and structural ancestors are path-transparent for descendants, harmonize remains in a stable canonical nesting chain:

```text
~/projects/<PERSONA>/<SESSION_ID>/provenance/search/gather/harmonize/
├── input/
├── meta/
└── output/
```

## Execution Paths
### Minimal Path (skip both optional branches)

```text
search -> gather -> [skip ml-readiness] -> [skip collect] -> join_gather_collect -> pre_harmonize -> harmonize -> code -> train -> federation
```

### Readiness Path (run `ml-readiness`, skip `collect`)

```text
search -> gather -> ml-readiness -> join_gather_collect -> pre_harmonize -> harmonize -> code -> train -> federation
```

### Full Branch Path (run `ml-readiness` and `collect`)

```text
search -> gather -> ml-readiness -> collect -> join_gather_collect -> pre_harmonize -> harmonize -> code -> train -> federation
```

In both paths, downstream stage locations remain stable under the canonical chain rooted at `search/gather/...`; branch variance is captured as upstream evidence, not as downstream path drift.

## End-State Example (Condensed)

```text
~/projects/<PERSONA>/<SESSION_ID>/
├── provenance/
│   └── search/
│       └── gather/
│           ├── output/                       # raw cohort view
│           ├── ml-readiness/
│           │   └── output/
│           │       └── ml-readiness.json
│           ├── collect/                      # optional
│           │   └── output/
│           │       └── collection-manifest.json
│           ├── join_gather_collect/          # structural
│           │   └── output/
│           ├── pre_harmonize/                # structural
│           │   └── output/
│           ├── harmonize/
│           │   └── output/
│           ├── code/
│           │   └── output/
│           ├── train/
│           │   └── output/
│           └── federate-*/
│               └── output/
└── <stage>@ symlinks
```

## Conclusion
The readiness-first FEDML contract changes one critical ordering decision: experiment viability is evaluated immediately after cohort assembly, before optional reorganization and long-horizon compute stages. This reduces wasted execution, prevents ambiguous training objectives, and keeps scientific intent explicit in lineage.

At the same time, the provenance model remains stable and deterministic. Optional and structural branches remain fully auditable but do not fracture downstream path contracts. The result is a pipeline that is both stricter scientifically and cleaner operationally: evidence remains complete, stage paths remain predictable, and harmonization-to-federation consumers do not need to chase branch-specific tree shapes.

---
_Last updated: 2026-02-23 (readiness-first contract; branch/join topology corrected)_
