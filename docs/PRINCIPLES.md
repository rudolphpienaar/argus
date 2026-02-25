# ARGUS Architectural Principles

These principles are the load-bearing beliefs of the system. They are not preferences
or conventions — they are the reasons the architecture is the way it is. When a design
decision conflicts with one of these, the principle wins or the principle is explicitly
revised with a documented reason.

---

## 1. Data-State Computation

**Progress is proven by materialized artifacts, not asserted by a controller.**

The session tree in the VirtualFileSystem IS the workflow state machine. A stage is
complete when its artifact exists at the correct topological path. No database, no
explicit state transition, no progress counter. The physical tree is the ground truth.

This is the ChRIS principle applied to conversational interfaces. It means:
- Any surface can query workflow state by inspecting the VFS — no API needed.
- Workflow state survives restarts, crashes, and reconnections naturally.
- Provenance is intrinsic, not recorded separately.

---

## 2. Topological Provenance

**The path of an artifact is its proof of ancestry.**

Every artifact materializes at a path that encodes the full DAG lineage of its
production: `search/gather/join_ml-readiness-gather/.../harmonize/meta/harmonize.json`.
That path is not a naming convention — it is a structural assertion that every named
ancestor ran and produced valid output before this artifact existed.

This is the Merkle principle made human-readable. Auditors do not need a log — the
filesystem is the log.

---

## 3. Manifest-as-Law

**If a command is not in the active manifest, it does not exist.**

The workflow topology, commands, stage transitions, auto-execution rules, skip behavior,
and display metadata are entirely declared in YAML manifests. The kernel has zero
hardcoded workflow knowledge. A new workflow is a new manifest file, nothing else.

This means:
- No `if (command === 'gather')` anywhere in the kernel.
- The kernel discovers commands at runtime by reading the manifest.
- Changing a workflow requires changing the manifest, not the kernel.

---

## 4. Precedence of Truth

**Deterministic resolution always precedes probabilistic resolution.**

The intent pipeline is strictly ordered: hardware interceptors → manifest fast-path →
LLM compilation → guardrail validation. The LLM is the last resort, never the first.
This prevents the probabilistic layer from interfering with the deterministic core.

The LLM's vocabulary is "jailed" to the set of commands that are actually ready in the
current DAG position. It cannot hallucinate commands that the manifest does not permit.

---

## 5. Own the Semantics, Delegate the Mechanics

**Novel ideas require custom semantic foundations. Standard operations do not.**

A semantic foundation is one where a change requires reasoning about what ARGUS means.
A mechanical foundation provides services the thesis uses but does not implement the
thesis itself.

| Semantic (own it) | Mechanical (delegate it) |
|---|---|
| Topological path construction | In-memory node storage |
| Merkle fingerprinting | Event broadcasting to subscribers |
| DAG resolver and transition logic | Dynamic module loading |
| Plugin ABI (`PluginContext`) | Filesystem path parsing |
| CNS intent pipeline | HTTP/WebSocket transport |
| Manifest parser | JSON/YAML serialization |

Owning mechanical foundations does not strengthen the thesis — it adds failure surface
and draws engineering effort away from the semantic layers. The substrate must be
trusted so the ideas built on it can be examined clearly.

---

## 6. Surfaces are Views, Not Applications

**The TUI and WUI are co-equal renderers of the same session state. They are not
separate applications.**

A surface does not own the session. The session lives in the kernel (VFS + store). A
surface is a rendering idiom: the TUI renders session events as text; the WUI renders
them as visual components. Both respond to the same underlying events.

This means:
- An intent submitted from the WUI is executed by the kernel and its response is
  rendered by BOTH surfaces simultaneously, each in its full native idiom.
- An intent submitted from the TUI is rendered by the WUI at full fidelity and vice
  versa — not as a notification or badge, but as a complete rendering of the event.
- A user at the TUI while a colleague operates the WUI sees the WUI-originated gather
  execute in real time, including the telemetry stream, exactly as if they had typed it.
- The session state is always the source of truth, never the surface state.

**Full-fidelity rendering is the invariant.** The secondary surface does not receive
a summary. It runs its complete rendering pipeline on the same `CalypsoResponse` the
primary surface received. Both renderings are authoritative.

---

## 7. Intent Equivalence

**A WUI visual intent and a TUI textual intent are the same thing at the kernel level.**

Clicking the "gather" pill in the LCARS interface produces the same `CalypsoIntent` as
typing "gather" in the terminal. The pill is not a button that calls an API — it is a
surface-specific translator that expresses a manifest command through a visual gesture.
The input modality is surface-specific; the intent is surface-agnostic.

This is the LCARS principle: all input modalities — touch, voice, text, gesture — are
equivalent translations of the same underlying command vocabulary. The manifest defines
that vocabulary. Surfaces provide access to it through their own idiom.

Corollaries:
- The Session Bus does not route "WUI events" and "TUI events" — it routes intents.
  The originating surface is metadata (for attribution), not a routing key.
- The WUI pill renderer derives its vocabulary directly from the manifest — it does not
  hardcode commands. A new manifest stage automatically produces a new pill.
- A "visual search" (clicking a dataset in the WUI catalog) and a textual search
  ("search segmentation") are the same intent at the kernel level. The WUI renders
  results as a visual grid; the TUI renders them as a text table; the kernel is
  indifferent.

---

## 8. Layered Defense of Semantic Foundations

**Every semantic layer must be defended at multiple levels. The depth of defense should
be proportional to the centrality of the layer to the thesis.**

A single test suite is a single line of defense. A semantic core — one whose corruption
would silently violate the thesis — requires defense in depth:

| Defense Level | Mechanism | Catches |
|---|---|---|
| 1. Types | TypeScript static types | Structural contract violations at compile time |
| 2. Runtime validation | Zod schemas at system seams | Malformed data crossing trust boundaries |
| 3. Unit tests | Example-based vitest specs | Known edge cases and regression |
| 4. Property tests | `fast-check` generative tests | Invariant violations across the input space |
| 5. Oracle tests | End-to-end scenario replays | Systemic behavioral drift |
| 6. Module isolation | Import boundary enforcement | Architectural principle violations |

The topological path algorithm, the Merkle fingerprinting, the DAG transition logic,
and the CNS intent pipeline all warrant all six levels. Infrastructure code (event
broadcasting, module loading) warrants levels 1 and 3 at most — which is exactly why
it should be delegated to proven libraries rather than reimplemented.

---

## 8. Kernel Isolation

**The kernel must not import from any surface module. Ever.**

The kernel (`src/lcarslm/`, `src/dag/`, `src/vfs/`, `src/plugins/`) does not know that
surfaces exist. It does not know what a WebSocket is, what a browser panel is, or what
a terminal renderer is. It processes a command string and returns a typed response.

If you find an import from `src/calypso/` (the transport layer) anywhere in the kernel,
that is an architectural violation to be corrected immediately.

Corollary: plugins do not know their sibling stages by name. A plugin receives a
`PluginContext` containing the VFS, store, and its own parameters. It does not receive
knowledge of what came before it or what comes after.
