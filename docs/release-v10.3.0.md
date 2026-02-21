# ARGUS v10.3.0 Release Notes

## Abstract
Version `10.3.0`, released on February 20, 2026, is the first explicit deletion
release after the v10.2 hardening checkpoint. Its purpose is to reduce architectural
surface area by removing migration-era compatibility branches that no longer serve
the production trajectory. The governing principle is monotonic simplification:
retain one runtime path per responsibility and delete alternative scaffolds.

## Introduction: Why Deletion Became Mandatory
The v10.2 line restored boundary discipline between backend kernel behavior and
plugin compute ownership, but it intentionally left compatibility wiring in place to
avoid destabilizing the release cut. That temporary coexistence carried a known
risk. Multiple runtime modes for materialization and stage-root behavior create
semantic ambiguity even when tests remain green, because operators and developers
cannot infer one canonical contract from code inspection alone.

`10.3.0` addresses that risk by treating compatibility toggles as technical debt
rather than convenience. The release objective was to remove those branches while
preserving externally observable workflow correctness.

## Resolution
The deletion pass removes legacy materialization mode branching, eliminates join-mode
toggle pathways from active backend configuration flow, and deletes SessionStore
flat-root compatibility semantics so stage paths follow one deterministic contract.
After deletion, verification gates were rerun to ensure the reduced runtime still
produces the expected graph and store outcomes under oracle pressure.

## Architectural Outcome
`10.3.0` establishes the subtraction baseline of the v10 line. Runtime semantics are
now easier to reason about because compatibility multiplexing has been collapsed into
single-path execution. This release is therefore not an endpoint but a preparatory
state for further hardening on the road to `11.0`, where Host-kernel integrity,
plugin compute ownership, and adapter rendering responsibilities are expected to
remain contract-locked without transitional branches.
