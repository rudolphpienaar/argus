# ARGUS v10.3.0 Release Notes

**Date:** 2026-02-20  
**Type:** Deletion release

## Summary
`v10.3.0` is the subtraction checkpoint for the v10 line.  
This release removes migration-era runtime compatibility scaffolding and keeps one canonical execution path.

## Key Messages
- Runtime materialization now follows a single canonical store/join path.
- Legacy runtime mode and join-toggle configuration branches were removed from active backend runtime.
- `SessionStore` flat-root compatibility mode was removed; one stage-path contract remains.
- Verification remains green (unit tests + oracle scenarios).

## Architectural Positioning
- `v10.2.2`: hardening baseline.
- `v10.3.0`: deletion baseline (this release).
- `v11.0`: contract lock (Host kernel vs plugin compute vs adapter rendering boundaries).
