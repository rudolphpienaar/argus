# ARGUS Development Context

## Abstract

This context log captures the hardening period that closed the gap between the
v10 architectural intent and the v10 runtime reality. The central pressure was
not feature incompleteness. The pressure was semantic drift: workflow control
decisions were still partly implicit while provenance contracts required every
decision to be physically materialized.

The entries below document the migration from partial state grounding to full
data-state semantics. The outcome is a stricter model in which backend runtime
stays production-pure, plugin compute owns optional simulation latency, and DAG
control transitions are represented as artifacts rather than controller
assumptions.

## 2026-02-19 to 2026-02-20: Hardening Sequence

During this window, ARGUS moved from a transitional session model to
project-relative provenance. Session and Merkle paths are now resolved under the
active project tree at `/home/${user}/projects/${projectName}/data/`, which
eliminates the legacy split between transient session logs and project payload
reality. This shift made provenance a physical property of the project itself,
and forced path consumers to realign around project identity changes such as the
`DRAFT` to named-project rename transition.

At the same time, command interpretation was constrained to stage-valid verbs by
default through strict contextual resolution in `WorkflowSession`. The immediate
goal was to stop conversational spillover where generic confirmations or cross-
stage language could be interpreted as workflow mutations in the wrong phase.
This stage lock was necessary, but it exposed deeper gaps in control-flow
materialization, which surfaced in oracle hangs.

## Reflexive Verification Contract

Verification was re-grounded around plugin self-reporting. Instead of hardcoding
expected artifact paths in test logic, plugins now report `materialized` paths
that are embedded in Merkle envelopes and re-checked by ORACLE. This move
aligned runtime and verification contracts: the same code path that produces side
effects now declares them, and the runner validates those declarations against
the virtual filesystem.

The result is a stronger claim than conversational correctness. A step is only
accepted when the protocol status and filesystem evidence agree.

## Instability Window and Failure Catalysts

Hardening produced a short instability period with several interacting defects.
Merkle branching logic produced redundant `_BRANCH_` path growth when equivalent
stage states were represented by non-normalized artifact payloads. Pronoun
grounding order also caused lexical collisions, where command arguments could be
misread as referents. In parallel, simulated delay combined with resolver stalls
inflated runtime variance and pushed oracle scenarios over timeout thresholds.

The most important failure, however, was recursive rename dispatch after gather
completion. That defect was not a simple parser bug. It was a contract hole in
how optional parents were represented at JOIN boundaries.

## Infinite Loop Diagnosis

The failing path appeared in rename-containing oracle walks after gather
materialization. The command entered deterministic workflow handling, strict stage
resolution rejected the verb in the current stage context, and dispatch
incorrectly fell through to conversational compilation. The model emitted an
action frame that reissued rename, creating a fresh top-level command loop.

```text
rename command -> strict stage reject -> silent conversational fallback
-> [ACTION: RENAME ...] -> command executor -> rename command (again)
```

Watchdog protection did not terminate this cycle because each iteration was a new
top-level dispatch rather than a single long-lived plugin call.

## Architectural Root Cause

The deeper cause was incomplete data-state semantics at DAG JOINs. Optional
control decisions were encoded as resolver alias logic rather than
as artifacts. That allowed the system to treat an optional stage as implicitly
resolved without writing evidence. Later, when language requested explicit action
for that optional stage, runtime had no materialized decision record to consult.
The controller therefore oscillated between incompatible interpretations.

## JOIN-as-State Resolution

The corrective model treats JOIN resolution as a first-class data state. Optional
parents are resolved explicitly either by execution artifacts or by decline
artifacts, and advancement occurs only after those states are materialized. In
the current implementation this is represented by skip sentinels written as
standard artifacts, allowing the position resolver to advance through the same
artifact evidence path used by normal stage completion.

This removed the need for alias completion semantics and eliminated the recursion
surface that caused rename loops.

## Implemented Runtime Changes

The implemented hardening pass removed stage-alias completion from the
FedML manifest lineage, eliminated stage-alias fingerprint resolution in adapter
logic, and routed strict-lock workflow misses through manifest-global workflow
dispatch rather than LLM fallback. `WorkflowSession.verify_fast()` was also
corrected to detect self-completed stages and force advancement, which closed
stalled-pointer behavior observed in federation execution transitions.

Session realignment now propagates path updates into store state so status and
position providers remain synchronized after project renames. Backend synthetic
latency paths were removed, leaving delay ownership entirely in plugins and
controlled for tests through `CALYPSO_FAST=true`.

## Current Posture

The hardening line is currently stable under unit and oracle pressure, including
rename/anaphora scenarios that previously deadlocked. Remaining cleanup work is
evolutionary rather than corrective: release cut hygiene, continued script-runtime
parity alignment with workflow dispatch semantics, and optional future
consolidation of per-stage skip artifacts into a JOIN-scoped resolution envelope.
