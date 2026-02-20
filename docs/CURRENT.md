# Current Project Status

**Date:** 2026-02-20
**Version:** v10.2.2
**Focus:** Production-Pure Backend and Plugin-Owned Compute

## Recent Changes
- **Plugin-Only Federation:** Replaced legacy federation orchestration with 8 stage-scoped plugins (`federate-*`) loaded by manifest handler.
- **Backend Purge:** Removed `src/lcarslm/federation/*`, removed `federationState` from store/types, and removed `federate --yes` runtime/script pathways.
- **Latency Boundary Enforcement:** Backend no longer injects synthetic sleep into compute flow; simulation delay remains plugin-owned and gated by `CALYPSO_FAST`.
- **Script Runtime Alignment:** Updated `fedml-fullrun` script catalog/YAML to explicit stage commands (`federate`, `approve`, `dispatch`, `status`, `publish model`).
- **Oracle Stability:** `oracle-runner` now sets `CALYPSO_FAST=true` and all 9 oracle scenarios pass.
- **Test Health:** Full test suite is green (`355/355`), including prior store and MerkleEngine regressions.
- **Release Cut:** Project version bumped to `10.2.2` as the hardening milestone for the 10.x line.

## Release Messaging (v10.2.2)
- **Theme:** Hardening release.
- **Positioning:** `v10.2.2` is the stabilization checkpoint after the plugin-first federation/backend cleanup.
- **Guarantee:** Backend remains production-pure (no synthetic compute delay in Host paths); any latency simulation is plugin-local and `CALYPSO_FAST`-gated.
- **Readiness:** Full unit suite and oracle suite pass on the release line.

## Next Steps
- Begin `v10.3` deletion pass (remove remaining compatibility/migration scaffolding).
- Define `v11.0` contract lock boundaries (Host kernel vs plugin compute vs UI adapters).
