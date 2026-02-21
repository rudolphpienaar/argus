# ARGUS v10.2.2 Release Notes

## Abstract
Version `10.2.2`, released on February 20, 2026, formalizes the hardening boundary
for the late v10 line. The release does not expand features. It resolves a
structural inconsistency discovered during post-overhaul cleanup: federation logic
had moved toward plugins in principle, yet residual backend pathways and simulation
surrogates still represented transitional behavior.

The release therefore frames stabilization as architectural purification. Backend
runtime now behaves as a production-pure host substrate, while latency simulation
belongs exclusively to plugin compute paths where domain behavior is declared and
testable.

## Introduction: Catalyst and Investigation
The catalyst for `10.2.2` was the recognition that migration-era seams can survive
major refactors without immediately breaking tests. In this case, synthetic delay
and federation coupling traces in backend code represented hidden policy surfaces
that would become debt once real filesystem and network substrates are connected.

Investigation of runtime flow showed that the intended Host/Guest boundary had to be
made absolute. Host responsibilities were constrained to deterministic orchestration,
state grounding, and typed dispatch. Compute realism and staged latency effects were
re-centered in plugins, where they can be switched off for verification throughput
via `CALYPSO_FAST=true` without contaminating kernel behavior.

## Resolution
The `10.2.2` hardening pass materializes federation steps as explicit
`federate-*` plugins and removes backend synthetic compute delay paths. Verification
pressure was then reapplied across unit and oracle suites under fast-mode policy to
confirm that deterministic semantics remain intact while the backend contract is
simplified.

## Architectural Outcome
`10.2.2` is the stabilization baseline immediately preceding deletion work. The
release establishes a stricter interpretation of the v10 architecture: manifests
declare workflow intent, plugins own compute behavior and optional simulation, and
the backend remains a production-pure integrity kernel. This state defines the
starting condition for `10.3.x` subtraction and the eventual `11.0` contract lock.
