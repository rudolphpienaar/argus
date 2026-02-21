# ARGUS v10.3.1 Release Notes

## Abstract
Version `10.3.1`, released on February 20, 2026, is a stabilization patch on top
of the `10.3.0` deletion baseline. The release fixes session continuity and oracle
verification drift that surfaced during full-suite execution after the backend
purification passes.

## Introduction: Why This Patch Was Required
During post-overhaul mop-up, the system passed unit tests but exposed a critical
runtime discontinuity in end-to-end oracle walks. On first `add`, project context
switched to a new `DRAFT-*` workspace, while upstream evidence from `search` could
be stranded in the prior session root. This caused stale stage pointers and
misrouted approvals in deeper federation phases.

In parallel, oracle scenario interpolation still synthesized `${session}` from a
default `DRAFT` project root instead of the runtime-resolved session path, creating
false negatives in generated persona scenarios.

## Resolution
`10.3.1` applies a focused repair set:

- `WorkflowSession.verify_fast` now rejects persisted pointers when the stage's own
  artifact already exists, forcing reconcile crawl instead of stale fast-path reuse.
- Gather project-switch logic now derives source session root from runtime `dataDir`
  and migrates provenance tree correctly into the newly activated project session.
- Oracle interpolation now resolves `${session}` from runtime `vars.session` instead
  of a synthesized default path.
- A regression test locks the search-to-add continuity contract so upstream artifacts
  must survive draft project activation.

## Validation
The release was validated with full local gates:

- `npm run build`
- `npm test`
- `node scripts/oracle-runner.mjs` (`9` scenarios passed)

## Architectural Outcome
`10.3.1` reinforces the production-pure backend doctrine by preserving a single
truthful session lineage across project transitions and keeping oracle assertions
bound to runtime state rather than template assumptions. It is a corrective patch,
not a feature branch, and tightens confidence ahead of v11 contract lock.

## Post-Release Stabilization Addendum (2026-02-21)
Two additional runtime stabilizations landed immediately after the release cut:

- Removed the legacy fixed `10s` host execution timeout from workflow plugin dispatch.
- Hardened CLI telemetry rendering to:
  - update progress in place (no line-per-tick "progress triangle"),
  - render glyph bars (`█`/`░`),
  - suppress spinner once telemetry begins and ignore late telemetry outside active command windows.

Validation remained green after this addendum:
- `npm test` (`370` tests passing)
- `node scripts/oracle-runner.mjs` (`9` scenarios passing)
