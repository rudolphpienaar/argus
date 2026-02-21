# ARGUS v10.3.2 Release Notes

## Abstract
Version `10.3.2`, released on February 21, 2026, is a documentation-closure patch
on top of the `10.3.1` stabilization line. The release publishes a code-current
FEDML materialization map so operators and tests can anchor on one explicit
artifact-path contract.

## Introduction: Why This Patch Was Required
After backend hardening and telemetry stabilization, runtime behavior was correct but
operator references were still fragmented. Stage handlers and artifact locations were
recoverable from code, yet there was no single document that tracked end-to-end path
materialization from `search` through `federate-model-publish`.

This gap increased friction in manual verification and oracle authoring, especially
for path-sensitive flows like project rename/no-rename branches and the external
`~/searches` snapshot namespace.

## Resolution
`10.3.2` applies a documentation and release-index patch set:

- Added `FEDML.md` as the canonical stage-by-stage pipeline map for
  `src/dag/manifests/fedml.manifest.yaml`.
- Added fully explicit final-tree variants for:
  - renamed project trajectory (`~/projects/histo-exp/...`),
  - non-renamed bootstrap trajectory (`~/projects/DRAFT-xxxx/...`),
  - external search snapshot namespace (`~/searches/search-*.json`).
- Updated release indexing in `README.md` and chronology in `docs/history.adoc`.
- Bumped runtime version markers to `10.3.2`.

## Validation
Release artifacts were cut with:

- `npm version 10.3.2 --no-git-tag-version`
- `npm run version:generate`

## Architectural Outcome
`10.3.2` does not alter Host/Guest execution semantics. Its value is contract
clarity: pipeline artifacts, side effects, and directory layouts are now documented
as a single code-aligned reference for operators, reviewers, and oracle maintenance.
