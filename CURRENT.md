# CURRENT STATE — 2026-02-15 (Emergency Context Dump)

## What Just Happened (Chronological)

### Commit 1: v7.3.0 — DAG Engine Integration
Replaced the old `WorkflowEngine` (5 hardcoded stages, `eval()` validation) with a
manifest-driven DAG engine. Session tree mirrors DAG topology. 323 tests pass.

### Commit 2: v7.3.1 — Federation Command Protocol Alignment
Decomposed FederationOrchestrator from monolithic `federate()` into `command(verb, args, username)`
dispatcher with 8 per-step handlers matching fedml.manifest.yaml stage IDs.
Oracle rewritten to use semantic commands (`approve`, `config name X`, `dispatch`, `publish model`)
instead of `federate --yes`.

### Commit 3: Remove `federate --yes` backward-compat alias
Deleted the `--yes`/`confirm` flag entirely. The manifest YAML is the sole command authority.
Removed `confirm` field from `FederationArgs` type. Users must use `approve` as the manifest declares.

## What We Were Planning When Context Ran Out

**Goal: Make personas fully manifest-driven — no persona-specific TypeScript.**

Adding a new persona should = writing one YAML manifest file. No TypeScript changes.

Three remaining coupling points where persona-specific knowledge leaks into TypeScript:

### 1. CompletionMapper Aliases (hardcoded per-persona)

**File: `src/dag/bridge/CompletionMapper.ts`**

`fedmlMapper_create()` hardcodes:
```typescript
{
    'search': 'gather',           // search completes when gather.json exists
    'rename': 'gather',           // rename completes when gather.json exists
    'federate-transcompile': 'federate-brief',  // all federation sub-stages
    'federate-containerize': 'federate-brief',  // alias to federate-brief
    // ... 6 more federation aliases
}
```

`chrisMapper_create()` hardcodes:
```typescript
'publish': () => false   // action/terminal, never auto-completes
```

**Fix**: Add `completes_with` field to manifest YAML:
```yaml
- id: search
  completes_with: gather    # check gather's artifact instead of search's

- id: publish
  completes_with: null      # action stage, never auto-completes
```

Replace per-persona mapper factories with one generic `manifestMapper_create()` that
reads `completes_with` from the parsed DAGDefinition. The `topologyMapper_create()` already
accepts an alias map — just build it from the manifest instead of hardcoding.

### 2. CalypsoCore.workflow_dispatch() Switch (hardcoded command→handler routing)

**File: `src/lcarslm/CalypsoCore.ts` lines ~1308-1400**

15-case switch statement hardcodes command→handler:
```typescript
case 'search':     response = this.workflow_search(args.join(' ')); break;
case 'gather':     response = await this.workflow_gather(args[0]); break;
case 'harmonize':  response = this.workflow_harmonize(); break;
case 'federate':   response = this.workflow_federate(args); break;
case 'approve':    if (this.federation.active) { ... } break;
// ... etc
```

**Fix**: Add `handler` field to manifest YAML:
```yaml
- id: harmonize
  handler: harmonize
  commands:
    - harmonize
```

Create a HANDLER_REGISTRY of shared capabilities:
```typescript
const HANDLER_REGISTRY: Record<string, ActionHandler> = {
    'search':     (core, args) => core.workflow_search(args.join(' ')),
    'gather':     (core, args) => core.workflow_gather(args[0]),
    'harmonize':  (core, args) => core.workflow_harmonize(),
    'scaffold':   (core, args) => core.workflow_proceed(args[0]),
    'rename':     (core, args) => core.workflow_rename(args.join(' ')),
    'federation': (core, verb, args) => core.federation.command(verb, args, username),
};
```

Build dispatch table at init from manifest: for each stage, map its commands to its handler.
The switch statement dies.

### 3. MANIFEST_REGISTRY (per-persona mapper wiring)

**File: `src/dag/bridge/WorkflowAdapter.ts` lines 72-81**

```typescript
const MANIFEST_REGISTRY: Record<string, ManifestEntry> = {
    fedml: {
        yamlPath: modulePath_resolve('../manifests/fedml.manifest.yaml'),
        mapper: fedmlMapper_create,   // ← persona-specific TypeScript function
    },
    chris: {
        yamlPath: modulePath_resolve('../manifests/chris.manifest.yaml'),
        mapper: chrisMapper_create,   // ← persona-specific TypeScript function
    },
};
```

**Fix**: Once CompletionMapper is generic (reads `completes_with` from manifest), the
per-persona mapper factories disappear. The registry becomes just persona ID → YAML path,
or scan the `manifests/` directory.

### 4. FederationOrchestrator (action implementation — stays as code)

This is legitimately code. What `dispatch` does (materializes VFS artifacts, writes rounds,
etc.) can't be declared in YAML. The handlers are CAPABILITIES — shared across personas.
FedML uses `search → gather → harmonize → scaffold → train → federation`.
ChRIS uses `gather → scaffold → test → publish`. Same handler library, different composition.

## Files to Modify

| File | Change |
|------|--------|
| `src/dag/graph/types.ts` | Add `handler: string` and `completes_with: string \| null` to DAGNode |
| `src/dag/graph/parser/manifest.ts` | Parse `handler` and `completes_with` from YAML |
| `src/dag/manifests/fedml.manifest.yaml` | Add `handler` and `completes_with` per stage |
| `src/dag/manifests/chris.manifest.yaml` | Same |
| `src/dag/bridge/CompletionMapper.ts` | Replace `fedmlMapper_create`/`chrisMapper_create` with generic `manifestMapper_create(definition, pathMap)` |
| `src/dag/bridge/WorkflowAdapter.ts` | Remove per-persona mapper factories from MANIFEST_REGISTRY; use generic mapper |
| `src/lcarslm/CalypsoCore.ts` | Replace switch with dispatch table built from manifest + handler registry |
| `src/dag/bridge/bridge.test.ts` | Update for new generic mapper |

## Design Considerations

1. **Handler interface must be async** — `workflow_add()` and `workflow_gather()` are async.
   Use `(core, args) => Promise<CalypsoResponse | null>`.

2. **Federation is special** — federation sub-stages all use the `federation` handler but
   with different verbs. Handler receives `(core, verb, args)` where verb is `approve`,
   `show`, `config`, `dispatch`, `status`, `publish`. Commands only route to federation
   handler when `federation.active` is true, otherwise fall through to null (→ LLM).

3. **Action stages** — stages with `completes_with: null` are terminal/action stages.
   Currently only ChRIS `publish`. Their completion check always returns false.

4. **Default completion** — stages without `completes_with` check their own artifact
   at the topology-aware path (existing behavior).

5. **`transition_check` and `workflowStage_complete`** — the logic around the switch must
   be preserved in the new dispatch table approach.

## Current Code State

- **v7.3.1** — 3 commits ahead of origin/main
- **323 tests pass** across 12 test files
- **Oracle passes** with 28 semantic steps
- **Build clean** — `tsc --noEmit` passes
- Plan mode was active when context ran out — no implementation started for this phase

## Test & Build Commands

```bash
npx vitest run                    # 323 tests
npm run build                     # tsc + manifest copy
node scripts/oracle-runner.mjs    # Oracle smoke test
npx tsc --noEmit                  # Type check
```

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/dag/graph/types.ts` | DAGNode, DAGDefinition, WorkflowPosition types |
| `src/dag/graph/parser/manifest.ts` | YAML → DAGDefinition parser |
| `src/dag/bridge/WorkflowAdapter.ts` | CalypsoCore-facing API, MANIFEST_REGISTRY |
| `src/dag/bridge/CompletionMapper.ts` | Stage → VFS completion checks, per-persona factories |
| `src/dag/bridge/SessionPaths.ts` | Topology-aware path computation |
| `src/dag/bridge/bridge.test.ts` | 34 bridge tests |
| `src/dag/manifests/fedml.manifest.yaml` | FedML workflow (14 stages) |
| `src/dag/manifests/chris.manifest.yaml` | ChRIS workflow (4 stages) |
| `src/lcarslm/CalypsoCore.ts` | AI orchestrator, workflow_dispatch() switch |
| `src/lcarslm/federation/FederationOrchestrator.ts` | 8-step federation command dispatcher |
| `src/lcarslm/federation/types.ts` | FederationStep (8 values), FederationArgs |
| `tests/oracle/fedml-smoke.oracle.json` | Oracle smoke test (28 steps) |
| `scripts/oracle-runner.mjs` | Oracle test runner |

## The Big Picture

```
manifest.yaml (topology + commands + handlers + completion aliases + instructions)
      ↓
WorkflowAdapter (parses manifest, builds command→handler dispatch table)
      ↓
CalypsoCore (routes input through dispatch table, NOT hardcoded switch)
      ↓
Handler registry (shared action implementations — capabilities, not personas)
      ↓
Oracle (derivable from manifest — walk stages, emit commands, assert artifacts)
```

Adding a persona = one YAML file. The manifest is the single source of truth for the
entire command surface. No TypeScript changes required.
