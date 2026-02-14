# CURRENT: Manifest-Driven Workflow Sequencing

> Active design document. Updated as thinking evolves.
> Last updated: 2026-02-14

## Problem Statement

Calypso's data-state grounding (VFS markers) answers **"where am I?"** reliably — the LLM reads artifact state and knows which stages are complete. But **"what comes next?"** is delegated to LLM inference, which drifts:

- After `search`, the LLM skips `gather` and jumps to harmonization
- After `gather`, the LLM forgets to offer `rename`
- After `python train.py`, the LLM jumps to "Federation Dispatch" without acknowledging the sub-steps (transcompile → containerize → publish → dispatch)

**Root cause:** Sequencing is not grounded. The workflow definition (`fedml.ts`) defines completion conditions (data-state gates) but not instruction sequences (what to tell the user next). The LLM confabulates plausible but wrong next steps.

## Solution: Persona Manifests

A **manifest** is a YAML document that defines the complete conversational DAG for a persona path. It grounds sequencing the same way VFS artifacts ground state.

### Key Distinction

| Concept | Purpose | Format |
|---------|---------|--------|
| Workflow definition (`fedml.ts`) | Completion conditions — data-state gates | TypeScript, stages with `validation.condition` |
| Manifest (`fedml.manifest.yaml`) | Conversational DAG — full instruction sequences | YAML, stages with `instruction`, `commands`, `produces` |
| Script (`*.script.yaml`) | Automation shortcut — subset of manifest stages | YAML, anchored to a manifest via `manifest:` field |

Manifests are the **blueprint**. Workflow definitions are the **validation layer**. Scripts are **shortcuts** through the blueprint.

### File Naming Convention

Compound extensions for editor YAML support + type identity:

- `fedml.manifest.yaml` — persona manifest
- `histo-harmonize.script.yaml` — automation script
- Both get YAML syntax highlighting and schema validation in editors

## DAG Structure

### Inspired by ChRIS Pipeline YAML

The manifest DAG follows the ChRIS pipeline convention where each node declares its **parent** (backward pointer), not its child (forward pointer). This naturally supports:

- **Branching** — multiple nodes pointing to the same parent
- **Joining** — a node listing multiple parents
- **Linear sequences** — the common case, just one `previous`

### Every Stage Produces an Artifact

Following ChRIS data-state DAG semantics, **every stage materializes an artifact** — no exceptions. There are no "pass-through" stages. This keeps the runtime uniform: check `produces`, check fingerprint, done.

- **Repeatable stages** (search, code/test) use an **accumulation model**: each iteration appends to the artifact (e.g., `search.json` logs all queries and results). The final state is what gets fingerprinted when the user moves on.
- **Optional stages** that are skipped still materialize a **skip sentinel** (e.g., `{skipped: true, default: "DRAFT-1234"}`). The sentinel gets fingerprinted like any other artifact.
- **Informational stages** (federate-brief) materialize a record of what was presented (e.g., the briefing content and timestamp).

This eliminates all special-casing in the runtime. The Merkle chain is unbroken across every node.

## Two Trees: Session and Project

### Session Tree — Provenance Record

When a user logs in and selects a persona, a **session** is created. The session tree is a ChRIS-style nested DAG materialization where each stage nests inside its parent:

```
~/sessions/fedml/session-<id>/
  data/                                    ← search artifacts (search.json)
  gather/
    data/                                  ← gather artifacts (cohort composition)
    rename/
      data/                                ← rename artifacts (or skip sentinel)
      harmonize/
        data/                              ← harmonize artifacts
        code/
          data/                            ← code artifacts (accumulating: code + test cycles)
          train/
            data/                          ← local validation artifacts
            federate-brief/
              data/                        ← briefing record
              federate-transcompile/
                data/                      ← transcompile artifacts
                federate-containerize/
                  data/                    ← container build artifacts
                  ...                      ← federation continues nesting
```

The nesting literally encodes the DAG path in the filesystem. You can `ls` ancestry. Users don't work here directly — this is the computation record.

Sessions enable persistence: a user can log out, come back, choose a session, and Calypso continues where they left off.

### Project Tree — Working Space

The user works in a familiar, flat project directory:

```
~/projects/<project>/
  input/                                   ← mounted datasets, .cohort, .harmonized
  src/                                     ← train.py, user code, whatever they add
  .local_pass
```

The session tree records **what happened**. The project tree is **where you work**. Session artifacts reference or snapshot the project state at each transition — that's what gets fingerprinted.

### Joins via Symlinks

The nested directory structure naturally captures linear/branching paths. Joins from non-direct ancestors use **symlinks**:

```
~/sessions/fedml/session-<id>/
  gather/
    rename/
      harmonize/
        data/                              ← harmonize artifacts
        gather -> ../../../gather          ← symlink: join edge to non-direct parent
```

Harmonize nests physically under `rename/` (primary parent) but the symlink to `gather/` makes the join explicit and traversable. The runtime:

1. Reads `previous: [gather, rename]` from the manifest
2. Resolves `rename` via direct parent directory
3. Resolves `gather` via symlink
4. Checks both parents' `data/` for artifacts and fingerprints

This mirrors how ChRIS handles topological copies — joins are linked, not duplicated. The symlink **is** the join edge materialized in the filesystem.

**Generalization:** On a real filesystem, joins are symlinks. On object storage, they're reference/pointer objects. On ZeroFS, whatever linking primitive it provides. The storage backend abstracts this (see DAG Engine below).

## DAG Invalidation via Fingerprinting

### Merkle Chain Over the DAG

Each stage's artifact carries a fingerprint:

```
fingerprint(stage) = hash(own_content, fingerprint(parent_1), ..., fingerprint(parent_N))
```

This gives three things for free:

1. **Staleness detection** — `harmonize`'s recorded fingerprint includes `gather`'s fingerprint at the time it ran. If `gather` is re-executed, its fingerprint changes, and `fingerprint(gather_now) ≠ fingerprint(gather_at_harmonize_time)` → harmonize is stale.

2. **Precise invalidation boundary** — Walk forward from the changed node; only stages whose ancestor fingerprints don't match are stale. If a user redoes `gather` but the resulting `.cohort` is byte-identical, the fingerprint doesn't change and nothing downstream invalidates.

3. **No controller needed** — Pure data-state. The fingerprint IS part of the artifact. The runtime reads artifacts and compares hashes. No "dirty bit" to maintain, no event bus.

### Artifact Fingerprint Format

```yaml
# In session tree: gather/data/result.json
created: 2026-02-12T14:30:00Z
datasets: [ds-001, ds-002]
_fingerprint: a3f8c2...
_parent_fingerprints:
  search: 7b2e91...
```

Then downstream:

```yaml
# In session tree: gather/rename/harmonize/data/result.json
created: 2026-02-12T14:35:00Z
_fingerprint: b7d1e4...
_parent_fingerprints:
  gather: a3f8c2...
  rename: c4d9f1...       # even if rename was a skip sentinel
```

Runtime check: `artifact.parent_fingerprints.gather === current_gather_artifact.fingerprint` → fresh. Mismatch → stale, needs redo.

Content-addressed (hash comparison), not timestamp-based — re-running `gather` with the same datasets doesn't force a cascade.

### Staleness Response

Open question: does the user see staleness as a **warning** or a **hard gate**?

Likely a warning: "Your harmonization was based on a different cohort. Re-run harmonize?" The manifest could declare this per-stage (`on_stale: warn | block`).

## DAG Engine: `src/dag/`

The DAG machinery is a foundational layer — on par with VFS and the workflow engine. It has its own top-level module:

```
src/dag/
  graph/
    types.ts               ← DAGNode, DAGEdge, DAGDefinition (common output)
    validator.ts           ← cycle detection, orphan check, join validation (common)
    resolver.ts            ← walk topology, compute readiness from store state (common)
    parser/
      manifest.ts          ← manifest YAML → DAGDefinition
      script.ts            ← script YAML → DAGDefinition
      common.ts            ← shared parsing utilities (YAML loading, previous normalization)

  store/
    types.ts               ← StorageBackend interface
    SessionStore.ts        ← session lifecycle (create/resume/list) against any backend
    backend/
      vfs.ts               ← VFS backend (current — in-memory)
      fs.ts                ← real filesystem backend (future)
      object.ts            ← object storage backend (future)

  fingerprint/
    hasher.ts              ← compute stage fingerprints from content + parent fps
    chain.ts               ← Merkle chain validation, staleness detection
    types.ts               ← FingerprintRecord, StalenessResult
```

### Layer Separation

- **`graph/`** — pure topology. Parses YAML, validates DAG structure, resolves readiness. No I/O. Reads manifests and scripts through the same parser.
- **`store/`** — pure I/O. Materializes the DAG into storage: creates directories, writes artifacts, creates symlinks/links for joins. Manages session lifecycle. Backend-agnostic through the `StorageBackend` interface.
- **`fingerprint/`** — pure verification. Computes hashes, validates the Merkle chain, detects staleness. Read-only against the materialized tree.

### StorageBackend Interface

```
write(path, data)          ← materialize an artifact
read(path)                 ← retrieve artifact
exists(path)               ← check materialization
link(source, target)       ← create a join reference (symlink / object ref / etc.)
list(path)                 ← enumerate children
```

Today: VFS backend. Future: real FS on CalypsoServer sandbox, object storage, ZeroFS. Swap the backend, everything else stays the same.

### Integration

CalypsoCore and WorkflowEngine consume `src/dag/` rather than implementing any DAG logic inline. The existing `WorkflowEngine.stages_completed()` would eventually delegate to `dag/fingerprint/chain.ts` for readiness checks.

## FedML Manifest: Stage Inventory

The FedML manifest covers the full SeaGaP-MP pipeline. Current stage inventory:

### Phase 1: Search & Gather

| Stage | Previous | Produces | Notes |
|-------|----------|----------|-------|
| `search` | (root) | `search.json` | Accumulating: logs all queries + results |
| `gather` | search | `gather.json`, `.cohort` | Cohort assembly, project creation |
| `rename` | gather | `rename.json` (or skip sentinel) | Optional branch, rejoins at harmonize |

### Phase 2: Harmonize

| Stage | Previous | Produces | Notes |
|-------|----------|----------|-------|
| `harmonize` | gather, rename | `harmonize.json` | Data standardization, soft-skip warning |

### Phase 3: Code & Validate

| Stage | Previous | Produces | Notes |
|-------|----------|----------|-------|
| `code` | harmonize | `code.json` | Accumulating: code + test cycles |
| `train` | code | `train.json`, `.local_pass` | Local validation |

### Phase 4: Federation (5-step handshake)

| Stage | Previous | Produces | Notes |
|-------|----------|----------|-------|
| `federate-brief` | train | `briefing.json` | Briefing record |
| `federate-transcompile` | federate-brief | `transcompile.json` | Flower hooks, node.py |
| `federate-containerize` | federate-transcompile | `containerize.json`, `.containerized` | OCI image build |
| `federate-publish-config` | federate-containerize | `publish-config.json` | App name, org, visibility |
| `federate-publish-execute` | federate-publish-config | `publish.json`, `.published` | Registry push |
| `federate-dispatch` | federate-publish-execute | `dispatch.json`, `.federated` | Dispatch + 5 rounds |

**Total: 12 stages across 4 phases. Every stage produces an artifact.**

## Manifest-Stage Contract

Each stage in the manifest declares:

```yaml
- id: harmonize
  name: Data Harmonization
  phase: harmonize
  previous: [gather, rename]
  optional: false
  produces:
    - harmonize.json
  instruction: >
    Harmonize your cohort to ensure consistent data formats...
  commands:
    - harmonize
  skip_warning:
    short: Cohort not harmonized.
    reason: >
      Federated learning requires consistent data formats...
    max_warnings: 2
```

Fields:

| Field | Purpose |
|-------|---------|
| `id` | Unique stage identifier |
| `name` | Human-readable stage name |
| `phase` | Grouping for progress display |
| `previous` | Parent stage(s) — DAG topology |
| `optional` | Whether the stage can be skipped |
| `produces` | Artifacts this stage materializes (always non-empty) |
| `instruction` | What to tell the user at this stage |
| `commands` | Exact commands available |
| `skip_warning` | Educational warning if user tries to skip |

## Next Steps

- [ ] Finalize manifest YAML schema
- [ ] Write `fedml.manifest.yaml` with full stage definitions
- [ ] Define script-manifest anchoring (`manifest:` field in scripts)
- [ ] Design `src/dag/` module — types, interfaces, graph parser
- [ ] Implement `StorageBackend` interface + VFS backend
- [ ] Implement `SessionStore` — session creation, resume, listing
- [ ] Implement fingerprint generation and Merkle chain validation
- [ ] Wire manifest `instruction` and `commands` into LLM context injection
- [ ] Explore real FS backend for CalypsoServer sandbox
