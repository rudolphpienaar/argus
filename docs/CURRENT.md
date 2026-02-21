# Current Project Status

**Date:** 2026-02-21
**Version:** v10.3.2
**Focus:** Canonical Runtime Path + FEDML Artifact Documentation Closure

## Recent Changes
- **Plugin-Only Federation:** Replaced legacy federation orchestration with 8 stage-scoped plugins (`federate-*`) loaded by manifest handler.
- **Backend Purge:** Removed `src/lcarslm/federation/*`, removed `federationState` from store/types, and removed `federate --yes` runtime/script pathways.
- **Latency Boundary Enforcement:** Backend no longer injects synthetic sleep into compute flow; simulation delay remains plugin-owned and gated by `CALYPSO_FAST`.
- **Host Timeout Removal:** Removed legacy fixed `10s` workflow execution watchdog from `CalypsoCore.workflow_execute`; plugin compute now runs to completion unless it returns/throws.
- **Telemetry Renderer Fix:** CLI telemetry progress is now in-place (single-line rewrite) instead of per-event line growth; bars render with glyph blocks for readable live progress.
- **Telemetry Gating:** REPL ignores late telemetry outside active command windows and suppresses spinner once telemetry starts, preventing mixed-output artifacts.
- **Script Runtime Hardening:** Removed `fedml-quickstart` and `fedml-fullrun` from the built-in script catalog to eliminate FedML-specific orchestration bundles in host runtime scripting.
- **Oracle Stability:** `oracle-runner` now sets `CALYPSO_FAST=true` and all 9 oracle scenarios pass.
- **Test Health:** Full test suite is green (`370/370`), plus ORACLE `9/9`.
- **Release Cut:** Project version bumped to `10.3.2` for documentation closure and release indexing.

## Release Messaging (v10.3.2)
- **Theme:** Operator-clarity patch release.
- **Positioning:** `v10.3.2` publishes a code-current FEDML pipeline map with explicit terminal-state trees for renamed and non-renamed project paths.
- **Guarantee:** Runtime behavior unchanged; documentation now mirrors actual artifact envelopes and side-effect paths.
- **Readiness:** Full unit suite and oracle suite pass on the release line.

## Runtime Notes (2026-02-21)
- CLI progress rendering is intentionally stateful: each `progress` event rewrites one active row in-frame, avoiding the historical "progress triangle" artifact.
- Frame rendering is width-capped and clipped to terminal width to prevent box overflow in narrow shells.
- Host/runtime no longer imposes fixed-duration plugin kill semantics; timeout policy, if needed in future, must be explicit and cancellable rather than hardcoded.

## Next Steps
- Define `v11.0` contract lock boundaries (Host kernel vs plugin compute vs UI adapters).
