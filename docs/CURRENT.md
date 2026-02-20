# Current Project Status

**Date:** 2026-02-20
**Version:** v10.3.0
**Focus:** Canonical Runtime Path (Post-Deletion)

## Recent Changes
- **Plugin-Only Federation:** Replaced legacy federation orchestration with 8 stage-scoped plugins (`federate-*`) loaded by manifest handler.
- **Backend Purge:** Removed `src/lcarslm/federation/*`, removed `federationState` from store/types, and removed `federate --yes` runtime/script pathways.
- **Latency Boundary Enforcement:** Backend no longer injects synthetic sleep into compute flow; simulation delay remains plugin-owned and gated by `CALYPSO_FAST`.
- **Script Runtime Alignment:** Updated `fedml-fullrun` script catalog/YAML to explicit stage commands (`federate`, `transcompile`, `containerize`, `publish-config`, `publish-execute`, `dispatch`, `status`, `publish model`).
- **Oracle Stability:** `oracle-runner` now sets `CALYPSO_FAST=true` and all 9 oracle scenarios pass.
- **Test Health:** Full test suite is green (`355/355`), including prior store and MerkleEngine regressions.
- **Release Cut:** Project version bumped to `10.2.2` as the hardening milestone for the 10.x line.

## Release Messaging (v10.3.0)
- **Theme:** Deletion release.
- **Positioning:** `v10.3.0` removes migration-era runtime scaffolding and locks the canonical store/join materialization path.
- **Guarantee:** No legacy runtime materialization modes/toggles remain in active backend execution.
- **Readiness:** Full unit suite and oracle suite pass on the release line.

## Next Steps
- Define `v11.0` contract lock boundaries (Host kernel vs plugin compute vs UI adapters).
