# Code Smell Audit Record

Date: 2026-02-18  
Scope: `src/` and key runtime/support paths (`scripts/` where relevant)  
Method: static scan for architecture smells, typing escapes, oversized responsibilities, and test coverage gaps.

## Summary

This file tracks active code smells to tackle next. Resolved items are intentionally removed from this active list.

## High Severity Findings

No open high-severity findings.

## Medium Severity Findings

No open medium-severity findings.

## Low Severity Findings

No open low-severity findings.

## Quantitative Snapshot

- TS files scanned: 174 (`src/`)
- Largest runtime files by lines:
- `src/lcarslm/federation/FederationOrchestrator.ts` (930)
- `src/lcarslm/scripts/ScriptRuntime.ts` (865)
- `src/lcarslm/CalypsoCore.ts` (717)
- `src/calypso/ui/tui/TuiRenderer.ts` (704)
- `src/dag/bridge/WorkflowAdapter.ts` (638)
- `src/core/stages/process.ts` (530)
- `src/ui/components/FileBrowser.ts` (525)

## Tracking Guidance

When updating this document in future passes:
- Keep exact file/line references for every finding.
- Keep this file active-only; move resolved items to commit messages or changelog.
- Mark each finding as `open`, `mitigated`, or `closed`.
- Record the commit hash that mitigates/closes each item.
