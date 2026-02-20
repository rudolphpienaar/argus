# ARGUS v10.2.2 Release Notes

**Date:** 2026-02-20  
**Type:** Hardening release

## Summary
`v10.2.2` is the stabilization checkpoint for the v10 line.  
This release finalizes the backend purity pass and confirms plugin-first federation execution.

## Key Messages
- Federation compute is plugin-only (`federate-*` stage plugins).
- Backend runtime paths are production-pure (no synthetic compute sleeps).
- Latency simulation, when desired, is plugin-local and can be disabled with `CALYPSO_FAST=true`.
- Full verification baseline is green (unit tests + oracle scenarios).

## Architectural Positioning
- `v10.2.2`: hardening baseline.
- `v10.3`: deletion release (remove compatibility/migration scaffolding).
- `v11.0`: contract lock (Host kernel vs plugin compute vs adapter rendering boundaries).
