# CURRENT STATE — 2026-02-15

## What Just Happened

1. Completed DAG engine integration into CalypsoCore — old `WorkflowEngine` replaced by
   manifest-driven DAG engine with topology-aware session tree paths.

2. **Aligned FederationOrchestrator command protocol with fedml.manifest.yaml.** The old
   `federate --yes` sledgehammer (5-step state machine) has been replaced by semantic
   commands matching the 8 manifest stages: `approve`, `show transcompile`, `config name`,
   `dispatch`, `status`, `publish model`. The oracle exercises the real command language.

### Federation Command Protocol (NEW)

| Manifest stage | Command(s) | What happens |
|---|---|---|
| `federate-brief` | `federate` | Show briefing, advance to transcompile |
| `federate-transcompile` | `approve`, `show transcompile` | Materialize Flower transcompilation |
| `federate-containerize` | `approve`, `show container` | Build OCI container image |
| `federate-publish-config` | `config name/org/visibility`, `approve` | Configure publication metadata |
| `federate-publish-execute` | `approve`, `show publish` | Push to registry |
| `federate-dispatch` | `dispatch [--sites]` | Dispatch to federation network |
| `federate-execute` | `status`, `show metrics/rounds` | Monitor training (auto-completes) |
| `federate-model-publish` | `publish model`, `show provenance` | Publish model, write `.federated` |

`federate --yes` still works as backward-compat alias for `approve`.

### Topology-Aware Session Tree

```
session-root/
  data/search.json                                          ← root stage
  gather/
    data/gather.json                                        ← child of root
    rename/data/rename.json                                 ← child of gather
    harmonize/
      data/harmonize.json                                   ← child of gather
      code/
        data/code.json
        train/
          data/train.json
          federate-brief/
            data/federate-brief.json
```

## Architecture

### DAG Engine (`src/dag/`)

| Layer | Files | Tests |
|-------|-------|-------|
| Graph | `graph/types.ts`, `graph/parser/manifest.ts`, `graph/resolver.ts` | 58 |
| Store | `store/SessionStore.ts`, `store/backend/vfs.ts`, `store/types.ts` | 40 |
| Fingerprint | `fingerprint/hasher.ts` | 27 |
| Bridge | `bridge/WorkflowAdapter.ts`, `bridge/CompletionMapper.ts`, `bridge/SessionPaths.ts` | 34 |
| Manifests | `manifests/fedml.manifest.yaml`, `manifests/chris.manifest.yaml` | — |

Total: **323 tests all passing**.

### Bridge Layer

```
WorkflowAdapter          — CalypsoCore's single entry point
  ├─ position_resolve()  — "where are we?" (queries VFS, returns WorkflowPosition)
  ├─ transition_check()  — "can we do X?" (soft-block with skip warnings)
  ├─ stage_forCommand()  — reverse index: command string → DAGNode
  ├─ skip_increment()    — manages soft-block counters
  ├─ progress_summarize()— human-readable progress string
  └─ stagePaths          — Map<string, StagePath> topology-aware paths

CompletionMapper         — Maps stage IDs → VFS artifact checks
SessionPaths             — Computes topology-aware paths from DAG structure
```

### FederationOrchestrator

```
FederationOrchestrator.command(verb, rawArgs, username)
  ├─ 'federate'  → step_brief()             — show briefing
  ├─ 'approve'   → step_approve()           — context-dependent: advance current step
  ├─ 'show'      → step_show(subcommand)    — transcompile/container/publish/metrics/rounds/provenance
  ├─ 'config'    → step_config()            — name/org/visibility
  ├─ 'dispatch'  → step_dispatch()          — initiate federation
  ├─ 'status'    → step_status()            — training progress
  └─ 'publish'   → step_publish()           — model publication (completes handshake)
```

`FederationStep` type: 8 values aligned 1:1 with manifest stage IDs.

### CalypsoCore Routing

`workflow_dispatch()` switch routes: `federate`, `approve`, `show`, `config`, `dispatch`,
`status`, `publish` — all federation sub-commands gated on `this.federation.active`.
When no handshake active, these fall through to null → LLM.

### Dual-Write Pattern (Current)

Action handlers write BOTH:
- **Dotfile markers** to project workspace — consumed by Shell guards, CohortProfiler
- **ArtifactEnvelopes** to session tree — source of truth for workflow state

## Logical Next Steps

### Near-term: Eliminate Dual-Write
Migrate dotfile marker consumers to read from session tree instead:
1. `Shell.ts` — checks `.local_pass` for federation readiness
2. `CalypsoCore.ts` — guards that check `.harmonized`, `.local_pass`, `.federated`
3. `ProjectManager.ts` — writes `.cohort`, `.harmonized`

### Medium-term: Per-Stage Federation Artifacts
Currently all 8 federation sub-stages alias to `federate-brief` artifact.
Future: each step writes its own artifact at its topology-aware path.

### Medium-term: SessionStore Integration
Have `sessionArtifact_write()` go through `SessionStore.artifact_write()` for
automatic fingerprinting and parent-chain validation.

## Test & Build Commands

```bash
npx vitest run                    # 323 tests, all pass
npm run build                     # tsc + manifest copy + knowledge bundle
node scripts/oracle-runner.mjs    # FedML smoke oracle (28 steps, semantic federation commands)
npx tsc --noEmit                  # type check only
```

## Oracle

`tests/oracle/fedml-smoke.oracle.json` — reflexive NL testing where Calypso tests herself.

Federation steps now use semantic manifest commands:
```
federate                     → briefing
approve                      → transcompile
approve                      → containerize
config name histo-exp1-federated → set app name
approve                      → confirm publish config
approve                      → registry publication
dispatch                     → dispatch to sites
publish model                → publish trained model + complete handshake
```

Session tree assertions use topology-aware paths:
```
${session}/gather/data/gather.json
${session}/gather/harmonize/data/harmonize.json
${session}/gather/harmonize/code/data/code.json
${session}/gather/harmonize/code/train/data/train.json
${session}/gather/harmonize/code/train/federate-brief/data/federate-brief.json
```
