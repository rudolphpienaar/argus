# Session State - 2026-02-03

## Version
**v5.1.0** - "The Nexus Update"

## What Was Accomplished This Session

### 1. Unified Gather Logic
- **Problem**: In headless mode, "gather [dataset]" did not auto-create a draft project or mount the VFS, unlike the Web UI.
- **Solution**: Extracted project creation and gathering logic into a shared `ProjectManager`.
- **Created**: `src/core/logic/ProjectManager.ts` - Centralizes `project_gather` logic.
- **Refactored**: `src/core/stages/search.ts` now delegates to `ProjectManager`.
- **Refactored**: `src/lcarslm/CalypsoCore.ts` now delegates to `ProjectManager`.

### 2. Testing
- Created `src/core/logic/ProjectManager.test.ts` to verify draft auto-creation and VFS syncing.
- Verified 153 passing tests.

### 3. Key Files Modified
```
src/core/logic/ProjectManager.ts      # New shared logic
src/core/stages/search.ts             # UI now uses shared logic
src/lcarslm/CalypsoCore.ts            # Headless core now uses shared logic
src/core/logic/ProjectManager.test.ts # New test suite
```

## How to Use

### Headless Mode (Now Feature Parity with Web)
```bash
make calypso-cli
CALYPSO> search histology
CALYPSO> gather ds-012
# Output should confirm: "INITIATING NEW DRAFT WORKSPACE [DRAFT-XXXX]"
# VFS should be mounted at /home/user/projects/DRAFT-XXXX/input/
```

## Known Issues / Pending Work
- `projectStrip_render` in `search.ts` still has some inline logic for the `+ NEW` button that could be further unified, though `ProjectManager.project_createDraft` is available.

## Architecture Summary

```
┌─────────────────────────────────────────┐
│           PRESENTATION LAYER            │
├──────────────┬──────────────┬───────────┤
│   Web UI     │  Headless    │   Tests   │
│ (search.ts)  │(CalypsoCore) │           │
└──────┬───────┴──────┬───────┴─────┬─────┘
       │              │             │
       └──────────────┼─────────────┘
                      │
            [ ProjectManager ]  <-- NEW SHARED LAYER
            (project_gather)
                      │
       ┌──────────────▼──────────────┐
       │   VFS │ Store │ Shell       │
       └─────────────────────────────┘
```