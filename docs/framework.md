# ARGUS Framework Formalization Plan

> **Status:** Historical record of the v4.5.1 formalization effort (2026-01-30).  
> For current conventions, use `docs/framework.adoc`.  
> For architecture trajectory, use `docs/CONTEXT.md`.

This file records the framework formalization effort that moved ARGUS from a concentrated entry-point architecture toward a composable system with explicit boundaries.

## Overview

The initiative focused on reducing hidden coupling in `argus.ts`, extracting reusable services, and standardizing lifecycle and integration patterns so behavior is understandable from structure. The work is considered finalized, but this page remains a useful architectural memory for why certain conventions exist.

## Critical Analysis at v4.5.1

The strongest outcome was confirmation that `src/lcars-framework/` could operate as a dependency-light library surface. At the same time, the Process stage had already matured into a genuine VCS consumer, replacing hardcoded templates with lazy content reads and generated artifacts. Overlay behavior also became safer once the slot pattern prevented one consumer from corrupting another consumer's DOM.

Historically significant risks were retired during this phase. The `argus.ts` "god object" was dismantled, overlay ownership conflicts were structurally constrained, and stage lifecycle leaks were mitigated by explicit enter/exit semantics.

## Refactoring Program

The formalization sequence progressed through four linked extractions. Command parsing and dispatch moved into `src/core/logic/commands.ts`, LLM coupling moved into `src/lcarslm/AIService.ts`, window binding management was centralized in `src/core/logic/WindowBindings.ts`, and stage transitions were inverted so stage modules own lifecycle behavior while `argus.ts` orchestrates flow.

## Implementation Record

On 2026-01-30, the codebase audit confirmed modularization targets and locked this document as a state anchor. The command router and AI service extractions reduced entry-point complexity immediately. Window binding standardization then removed ad hoc `window` wiring patterns and improved type safety. Stage lifecycle inversion completed the shift from monolith-style control to modular orchestration. Documentation updates across onboarding and architecture texts ensured the new patterns were discoverable by new contributors.

## Final State

By the end of the initiative, ARGUS had a cleaner separation between orchestration, intent routing, stage logic, and UI mechanics. The project now behaves more like a framework-backed application than a single-file prototype, and that change is foundational for continued growth.
