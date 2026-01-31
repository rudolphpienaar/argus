# ARGUS Framework Formalization Plan
:author: ATLAS Project Team
:status: FINALIZED
:last-updated: 2026-01-30

## Overview
This document serves as the live state record for the "Framework Formalization" initiative. It tracks the refactoring efforts to decouple the ARGUS core application from the monolithic `argus.ts` entry point and standardize architectural patterns.

## 1. Critical Analysis (v4.5.1)

### Successes
*   **Framework Decoupling**: `src/lcars-framework/` is confirmed to be dependency-free. It imports only internal types, making it a portable library.
*   **VCS Adoption**: The `Process` stage fully utilizes the Virtual Computer System. IDE content is lazy-loaded from `vcs.node_read()`. Hardcoded HTML templates have been eliminated.
*   **Slot Pattern**: The Marketplace and Gather overlays successfully share the `#asset-detail-overlay` using the Slot Pattern, preventing DOM corruption.

### Critical Risks (RETIRED)
*   **The "God Object" (`argus.ts`)**: Resolved. Logic extracted to specialized services and routers.
*   **Rogue Overlays**: Addressed via Slot Pattern standardization.
*   **State Leaks**: Resolved via Stage Lifecycle hooks.

## 2. Refactoring Roadmap

### Phase 1: Dismantle the God Object (Command Router)
Extract command parsing and dispatch logic from `argus.ts` into a dedicated router.
*   **Goal**: `argus.ts` should not know about specific commands (search, federate, mount).
*   **Target**: `src/core/logic/commands.ts`
*   **Status**: **COMPLETE**

### Phase 2: Extract AI Service
Move the Large Language Model (LLM) interaction, context building (Search Buffer), and response parsing into a standalone service.
*   **Goal**: Centralize AI logic; decouple RAG strategy from the event loop.
*   **Target**: `src/lcarslm/AIService.ts`
*   **Status**: **COMPLETE**

### Phase 3: Standardize Window Bindings
Replace scattered `window.foo = foo` assignments with a centralized registry that ensures type safety.
*   **Goal**: A single source of truth for all functions exposed to the DOM.
*   **Target**: `src/core/logic/WindowBindings.ts`
*   **Status**: **COMPLETE**

### Phase 4: Modularize Stage Lifecycle
Invert control for stage transitions. Instead of `argus.ts` manually setting up stages, each stage module should export lifecycle hooks.
*   **Goal**: `argus.ts` calls `currentStage.onExit()` -> `nextStage.onEnter()`.
*   **Target**: Update `src/core/stages/*.ts`
*   **Status**: **COMPLETE**

## 3. Implementation Log

### 2026-01-30
*   **Analysis**: Completed codebase investigation. Confirmed `lcars-framework` purity. Identified `argus.ts` as primary refactoring target.
*   **Plan Locked**: Established `docs/framework.md` as the source of truth.
*   **Refactor**: Extracted `src/core/logic/commands.ts` (Command Router) and `src/lcarslm/AIService.ts` (AI Service) from `argus.ts`. Reduced `argus.ts` size by ~150 lines. Build successful.
*   **Refactor**: Extracted `src/core/logic/WindowBindings.ts`. Standardized all `window` assignments and type declarations. Cleaned up entry point boilerplate. Build successful.
*   **Refactor**: Implemented Stage Lifecycle hooks (`onEnter`/`onExit`) in `src/core/stages/`. Inverted control in `argus.ts` stage transition handler. Entry point is now primarily orchestration, not business logic. Build successful.
*   **Documentation**: Created `docs/onboarding.adoc` as a high-level narrative guide for new developers. Updated `docs/architecture.adoc` and `docs/framework.adoc` to reflect the new modular patterns.

