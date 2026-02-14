# CURRENT: Manifest-Driven Workflow Sequencing

> Active design document. Updated as thinking evolves.
> Last updated: 2026-02-12

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

```yaml
stages:
  - id: gather
    previous: search
    produces:
      - "${project}/input/.cohort"

  - id: rename
    previous: gather
    optional: true
    produces: []              # pass-through — no gate artifact

  - id: harmonize
    previous: [gather, rename]   # join — rename is optional branch
    produces:
      - "${project}/input/.harmonized"
```

### `previous` vs `produces` (topology vs data-state)

These are orthogonal concerns:

- **`previous`** = structural topology. "Where do I sit in the DAG?" Used for rendering, sequencing guidance, understanding flow. Pure graph relationship.

- **`produces`** = data-state output. "What artifacts does this stage materialize?" The runtime checks these to determine readiness. This is data-state grounding applied to the manifest.

**Readiness is derived, not declared.** A stage is ready when all `produces` of all `previous` stages are materialized. No separate `requires` field needed — it falls out of the graph structure plus the output declarations.

### Stages That Produce Nothing

Stages like `search`, `rename`, and `federate-brief` are informational or interactive. They declare `produces: []` and are treated as pass-through — any downstream stage sees them as trivially complete and the runtime looks further back up the DAG for the real gate.

## Optional Branches

Optional stages (like `rename`) are modeled as proper DAG branches that rejoin:

```
gather ──→ rename ──→ harmonize
   │                     ↑
   └─────────────────────┘
```

- `harmonize` has `previous: [gather, rename]`
- `rename` is marked `optional: true` with `produces: []`
- If the user transits from `gather` directly to `harmonize`, the runtime sees two parents, one optional and unmaterialized
- The system prompts explicitly: "Do you want to skip the rename?"
- If skipped, a sentinel artifact is materialized (e.g., `{skipped: true, default: "auto-generated-name"}`) so the DAG stays artifact-gated everywhere
- No special "skip" logic in the runtime — just a different artifact value

## DAG Invalidation via Fingerprinting

### The Problem

The workflow is not a forced wizard. A user can reach harmonization, realize they forgot a dataset, and jump back to `gather`. When they change the cohort, downstream artifacts (`.harmonized`, `train.py`, `.local_pass`) become stale. How does the system detect this?

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
# ${project}/input/.cohort
created: 2026-02-12T14:30:00Z
datasets: [ds-001, ds-002]
_fingerprint: a3f8c2...
_parent_fingerprints:
  search: null          # root — no parent artifact
```

Then downstream:

```yaml
# ${project}/input/.harmonized
created: 2026-02-12T14:35:00Z
_fingerprint: b7d1e4...
_parent_fingerprints:
  gather: a3f8c2...     # gather's fingerprint at harmonize-time
```

Runtime check: `artifact.parent_fingerprints.gather === current_gather_artifact.fingerprint` → fresh. Mismatch → stale, needs redo.

This is essentially `make` semantics (timestamp comparison) but **content-addressed** (hash comparison), which is strictly better — re-running `gather` with the same datasets doesn't force a cascade.

### Staleness Response

Open question: does the user see staleness as a **warning** or a **hard gate**?

Likely a warning: "Your harmonization was based on a different cohort. Re-run harmonize?" The manifest could declare this per-stage (`on_stale: warn | block`).

## FedML Manifest: Stage Inventory

The FedML manifest covers the full SeaGaP-MP pipeline. Current stage inventory:

### Phase 1: Search & Gather

| Stage | Previous | Produces | Notes |
|-------|----------|----------|-------|
| `search` | (root) | — | Dataset discovery, repeatable |
| `gather` | search | `.cohort` | Cohort assembly, project creation |
| `rename` | gather | — | Optional, branches and rejoins at harmonize |

### Phase 2: Harmonize

| Stage | Previous | Produces | Notes |
|-------|----------|----------|-------|
| `harmonize` | gather, rename | `.harmonized` | Data standardization, soft-skip warning |

### Phase 3: Code & Validate

| Stage | Previous | Produces | Notes |
|-------|----------|----------|-------|
| `code` | harmonize | `src/train.py` | Scaffold project structure |
| `train` | code | `.local_pass` | Local validation before federation |

### Phase 4: Federation (5-step handshake)

| Stage | Previous | Produces | Notes |
|-------|----------|----------|-------|
| `federate-brief` | train | — | Informational briefing |
| `federate-transcompile` | federate-brief | `artifact.json` | Inject Flower hooks, generate node.py |
| `federate-containerize` | federate-transcompile | `.containerized` | Build OCI image |
| `federate-publish-config` | federate-containerize | — | Collect app name, org, visibility |
| `federate-publish-execute` | federate-publish-config | `.published` | Push to registry |
| `federate-dispatch` | federate-publish-execute | `.federated` | Dispatch + 5 federated rounds |

**Total: 12 stages across 4 phases.**

## Manifest-Stage Contract

Each stage in the manifest declares:

```yaml
- id: harmonize
  name: Data Harmonization
  phase: harmonize
  previous: [gather, rename]
  optional: false
  produces:
    - "${project}/input/.harmonized"
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
| `produces` | Artifacts this stage materializes (data-state outputs) |
| `instruction` | What to tell the user at this stage |
| `commands` | Exact commands available |
| `skip_warning` | Educational warning if user tries to skip |

## Next Steps

- [ ] Finalize manifest YAML schema
- [ ] Write `fedml.manifest.yaml` with full stage definitions
- [ ] Define script-manifest anchoring (`manifest:` field in scripts)
- [ ] Implement manifest loader in runtime
- [ ] Wire `instruction` and `commands` into LLM context injection
- [ ] Implement fingerprint generation and staleness detection
- [ ] Explore FS materialization (VFS → real filesystem on server sandbox)
