# ARGUS Development Context

## Abstract

This handoff log captures the transition from late-v10 hardening into the
`v11.0.0` contract-lock baseline. The critical theme is not incremental feature
addition. The critical theme is contract consolidation: startup telemetry,
manifest topology, provenance path semantics, shell interaction, and DAG
visualization now operate under explicit, test-enforced rules.

The goal of this document is zero-shot continuity for the next agent. A new
maintainer should be able to reconstruct why recent churn occurred, what was
fixed, what contracts are now authoritative, where edge risk still exists, and
how to validate the system without tribal context.

## Current Release Snapshot

- Version: `11.0.0`
- Head commit: `df2c11a`
- Branch: `main` (pushed to `origin/main`)
- Date of cut: 2026-02-23

This major bump is SemVer-justified by contract-surface change:

1. FEDML branch/join topology changed to readiness-first convergence.
2. Boot/login behavior moved to a phase/sequence telemetry contract.
3. Session/provenance and viewport behaviors were formalized and documented.
4. DAG rendering introduced a new modular visualizer path with bounded fallback.

## What Changed Since v10.3.2

### 1) Boot/Login Contract Repair

The prior user-visible failure was long startup delay with weak progress
visibility, especially around connection/login boundaries. Investigation showed
that milestone data existed but rendering semantics were not contract-tight:
subscription timing, prompt redraw interleaving, and transport ordering produced
missing or bursty boot lines.

Resolution:

- Introduced explicit boot phases (`login_boot`, `workflow_boot`) and ordered
  `boot_log` milestones with monotonic `seq`.
- Added dedicated timeline handling (`BootTimeline`) and phase lifecycle logic.
- Enforced hard-failure semantics on boot failure during login.
- Added/updated tests around boot telemetry ordering and failure behavior.
- Documented protocol in `docs/boot-contract.adoc` and analysis in
  `docs/boot-login.adoc`.

### 2) FEDML Topology Shift to Readiness-First

The previous branch narrative around rename-centric optional behavior was
scientifically weak for ML execution quality. The high-value gate is
feasibility/readiness immediately after `gather`.

Current FEDML topology between gather and harmonize:

- `gather -> ml-readiness`
- `ml-readiness -> collect` (optional reorganization branch)
- `ml-readiness -> join_gather_collect` (direct branch)
- `collect -> join_gather_collect`
- `join_gather_collect -> pre_harmonize -> harmonize`

Manifest source: `src/dag/manifests/fedml.manifest.yaml`

### 3) Gather Semantics and Dataset Materialization

`gather` no longer repacks cohorts into assumed training/validation structures.
It materializes selected cohort payloads as-is and leaves objective-specific
reorganization to optional downstream stages (for example `collect`).

This reduces hidden assumptions and keeps gather as acquisition/provenance,
not training-shape enforcement.

### 4) New Plugin Surface for the Readiness Pipeline

New/active stage handlers include:

- `src/plugins/ml-readiness.ts`
- `src/plugins/collect.ts`
- `src/plugins/topological-join.ts`
- `src/plugins/pre-harmonize.ts`
- `src/plugins/workspace-commit.ts`

These form the causal bridge from post-gather evidence to harmonize ingress.

### 5) DAG CLI and Visualizer Evolution

`dag show` gained deterministic routing and user-facing modes, including
`dag show --box`.

Important incident and fix:

- Initial Graphviz integration could hang under test/runtime conditions when
  `dot` was fed via stdin synchronously.
- Renderer was hardened by moving Graphviz execution into a localized module
  (`src/dag/visualizer/graphvizBox.ts`) with bounded execution and fallback.
- Invocation now uses a temp `.dot` file path and explicit fallback rendering.
- Tests added at `src/dag/visualizer/graphvizBox.test.ts`.

### 6) Shell and QoL Contracts

- Restored/fixed tab completion behavior for builtins and paths.
- `ls` wildcard handling corrected for patterns like `ls IMG*`.
- Added GNU-style `wc` builtin (`src/vfs/commands/wc.ts`).
- Added user-scoped settings service and `/settings` integration.
- Added conversational-width control (`convo_width`) and propagated width hints
  to rendering paths.

## v11.0.0 Baseline Contracts (Authoritative)

1. Workflow truth is manifest topology plus materialized artifact evidence.
2. Optional control decisions are represented by artifacts/sentinels, not
   controller folklore.
3. Boot phases are protocolized telemetry sequences with deterministic prompt
   gating.
4. Gather is acquisition/provenance, not implicit ML task reorganization.
5. Readiness and optional collection are distinct, explicit stage semantics.
6. DAG visualization is non-authoritative UX: it must never block runtime
   progression; fallback behavior is required.
7. User preference state is scoped per user and surfaced through settings APIs.

## Canonical Handoff Anchors

Read these first in order:

1. `docs/history.adoc` (now updated through `v11.0.0`)
2. `FEDML.md` (current FEDML DAG and tree contract)
3. `docs/dag-engine.adoc` (manifest/DAG execution semantics)
4. `docs/boot-contract.adoc` and `docs/boot-login.adoc` (startup protocol)
5. `docs/devexperience.adoc` (session/provenance + viewport model)
6. `src/dag/manifests/fedml.manifest.yaml` (single source for stage topology)

## Validation Snapshot at v11 Cut

Quality gates at release cut:

```text
npm test                         -> 415/415 passing
node scripts/oracle-runner.mjs  -> 9/9 scenarios passing
```

Both suites are currently expected to pass on `main` at `df2c11a`.

## Known Residual Risk / Work Queue

1. Some docs still intentionally preserve historical `v10.x` framing in their
   own revision metadata; this is not runtime debt but can create reader
   ambiguity if consumed out of order.
2. ORACLE scenario labels still include legacy naming strings (for example
   "v10 Protocol Verification") even though runtime is now `v11.0.0`.
3. DAG box output quality depends on local Graphviz availability/version;
   fallback is safe but less expressive.
4. Boot telemetry now has strict contract framing, but additional fine-grained
   substep telemetry can still be expanded in selected high-latency pathways.

## Zero-Shot Next-Agent Checklist

1. Confirm working tree and branch: `git status`, `git log -1 --oneline`.
2. Re-run gates before any behavioral change: `npm test` and
   `node scripts/oracle-runner.mjs`.
3. When touching workflow behavior, update all three together:
   - manifest (`src/dag/manifests/*.manifest.yaml`)
   - tests (`src/dag/bridge/bridge.test.ts`, relevant core tests)
   - docs (`FEDML.md`, `docs/dag-engine.adoc`, `docs/history.adoc`)
4. Preserve gather contract: no implicit dataset repacking in gather.
5. Preserve boot contract: phase-ordered telemetry and deterministic failure.
6. Preserve non-blocking DAG visualization behavior (never let rendering stall
   command execution/tests).
