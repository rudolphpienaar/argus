# ARGUS Engineering Plan — Completed History

| Version | Plan | Status |
|---------|------|--------|
| v11.0.5 | IAS Purity Refactor — CalypsoCore as domain-agnostic kernel | COMPLETE |
| v11.0.8 | Early Pipeline Gate Hardening — readiness + collection gates | COMPLETE |
| v11.0.9 | God-Object Modularization | COMPLETE |
| v11.0.16 | Intent-Guard Hardening — toggleable guardrail system | COMPLETE |
| v12.0.2 | CNS Consolidation + Null-Hypothesis Mode | COMPLETE |
| v12.0.x | Structural flag removal — `commands.length === 0` derivation | COMPLETE |
| v12.0.x | Persona leakage purge — kernel zero workflow knowledge | COMPLETE |
| v12.0.x | TelemetryBus → EventEmitter facade (Piece 1) | COMPLETE |
| v12.0.x | Session Bus — full-fidelity cross-surface coupling (Piece 2) | COMPLETE |
| v12.0.x | Zod defense hardening — WS wire + manifest boundaries (Piece 3) | COMPLETE |
| v12.0.x | fast-check property tests — SessionPaths, WorkflowAdapter, FastPathRouter | COMPLETE |

Live AI Oracle integration is parked in `BACKLOG.md`.

---

# Active Plan: Foundations Hardening + Cross-Surface Coupling

## What this plan is and is not

This is not an architectural sprint. It is three bounded pieces of work, in order of
ascending novelty and cost, each with a concrete done-state. The total is roughly a
week of focused work. This is not a magic mountain — it is a defined summit.

The principles guiding this plan are in `docs/PRINCIPLES.md`. The short version:
own the semantics (novel), delegate the mechanics (solved). Defend the semantic
cores at multiple levels.

---

## Piece 1: Outsource `TelemetryBus` to `EventEmitter`

**Why:** `TelemetryBus` is a 60-line reimplementation of `EventEmitter` with a typed
wrapper around a `Set<Observer>`. It is mechanical infrastructure, not semantic. Using
Node's native `EventEmitter` removes a custom failure surface and gives us `once()`,
`removeAllListeners()`, and listener-count introspection for free.

**Scope:** `TelemetryBus.ts` and its consumers. No behaviour changes. No new tests
needed beyond confirming existing 424 pass.

**Done state:** `TelemetryBus` is a typed facade over `EventEmitter`. All existing
telemetry tests pass. `tsc` clean.

**Cost:** ~2–3 hours.

### Steps

- [x] Rewrite `TelemetryBus` to wrap `EventEmitter` (composition, avoids emit signature conflict)
- [x] Define `CHANNEL = 'telemetry' as const` — single constant, no string literals at call sites
- [x] Confirm `TelemetryBus.subscribe()` / `TelemetryBus.emit()` public API unchanged
- [x] Run full test suite — 424 pass, no changes needed elsewhere

---

## Piece 2: Session Bus — Full-Fidelity Cross-Surface Coupling

**Why:** This is the novel capability. When a user clicks the "gather" pill in the WUI,
the TUI renders the full gather response — telemetry stream, output, new prompt — as
if the user had typed it. When a user types "search segmentation" in the TUI, the WUI
renders the result as a visual dataset grid. The surfaces are co-equal renderers of
the same session state. Neither is primary.

This is semi-novel: multi-surface systems exist, but semantic synchronization at the
intent level — where a visual gesture and a typed command are the same thing — is not
standard in scientific workflow tooling.

**What it is NOT:** A new pub/sub framework. The SessionBus is a thin typed facade over
`EventEmitter` (see Piece 1). The novelty is in the semantics: `SessionEvent` type,
the full-fidelity rendering contract, and the intent-equivalence protocol. The
broadcasting mechanics are two lines of EventEmitter.

**Done state:** TUI and WUI are live-coupled. A command from either surface triggers
a full render on both. `tsc` clean. New tests pass. Existing 424 pass.

**Cost:** ~2–3 days.

### New files

| File | Description |
|------|-------------|
| `src/calypso/bus/types.ts` | `SessionEvent` — the semantic event type |
| `src/calypso/bus/SessionBus.ts` | Typed facade: kernel + EventEmitter broadcast |
| `src/calypso/bus/SessionBus.test.ts` | 7 unit tests |

### Modified files

| File | Change |
|------|--------|
| `src/calypso/protocol/types.ts` | Add `SessionEventMessage` to `ServerMessage` |
| `src/calypso/server/CalypsoServer.ts` | Instantiate `SessionBus`, pass to WS handler |
| `src/calypso/server/WebSocketHandler.ts` | Use bus; register/unregister per connection |
| `src/calypso/server/WebSocketHandler.test.ts` | Add cross-surface broadcast tests |
| `src/calypso/client/CalypsoClient.ts` | Handle `session_event` message type |

### `SessionEvent` — the only genuinely custom type

```typescript
// src/calypso/bus/types.ts
export interface SessionEvent {
    sourceId: string;        // 'tui' | 'wui-<id>' | 'api'
    input: string;           // raw command string as submitted
    response: CalypsoResponse;
    timestamp: number;
}
```

### `SessionBus` — thin facade, EventEmitter mechanics

```typescript
// src/calypso/bus/SessionBus.ts
import { EventEmitter } from 'events';

export class SessionBus extends EventEmitter {
    private readonly surfaces = new Map<string, (event: SessionEvent) => void>();

    constructor(private readonly kernel: WebSocketCalypso) { super(); }

    surface_register(id: string, handler: (event: SessionEvent) => void): () => void {
        this.surfaces.set(id, handler);
        return () => this.surfaces.delete(id);
    }

    async intent_submit(input: string, sourceId: string): Promise<CalypsoResponse> {
        const response = await this.kernel.command_execute(input);
        const event: SessionEvent = { sourceId, input, response, timestamp: Date.now() };
        for (const [id, handler] of this.surfaces) {
            if (id !== sourceId) handler(event);
        }
        return response;
    }

    // Thin passthroughs: boot, workflow_set, prompt_get, tab_complete, etc.
}
```

### Protocol extension

```typescript
// src/calypso/protocol/types.ts — add to ServerMessage union
export interface SessionEventMessage {
    type: 'session_event';
    sourceId: string;
    input: string;
    response: CalypsoResponse;
    timestamp: number;
}
```

### `SessionBus` unit tests

- `routes intent to kernel and returns response`
- `broadcasts to all OTHER surfaces, not the originator`
- `unregistered surface receives no events`
- `sourceId correctly tagged in every broadcast event`
- `multiple surfaces each receive cross-surface events independently`
- `kernel.command_execute called exactly once per intent_submit`
- `surface_register cleanup: unregister stops delivery immediately`

### `WebSocketHandler` changes

Each WS connection generates a unique `connectionId`. On connect it registers a
handler with the bus. That handler sends `session_event` to the WS client. On close
it unregisters. The `command` message handler calls `bus.intent_submit()` and sends
the returned response directly to the caller — backward-compatible with existing
WUI/TUI clients that don't yet handle `session_event`.

### Full-fidelity contract

The WUI and TUI rendering pipelines are each responsible for applying their complete
render to any `session_event` they receive — identical to how they render their own
responses. The Repl's telemetry handler and response renderer must accept a
`CalypsoResponse` regardless of whether it arrived as `response` (own command) or
`session_event` (foreign command). Same code path. This is enforced by tests.

---

## Piece 3: Defense Hardening

**Why:** The semantic cores — topological path construction, Merkle fingerprinting,
DAG transition logic, CNS intent pipeline — are currently defended at two levels:
TypeScript types and example-based unit tests. This plan adds two more levels:
runtime boundary validation (Zod) and property-based invariant tests (fast-check).

Per `docs/PRINCIPLES.md` Principle 8, depth of defense should match centrality to
the thesis. These components are the thesis. They get all six levels.

**Done state:** Zod schemas at manifest/kernel and kernel/surface seams. fast-check
property tests for `stagePathLiteral_resolve`, `autoExecuteCompletion_resolve`, and
`intent_resolve`. All existing tests pass. No regressions.

**Cost:** ~2–3 days.

### 3a. Zod at trust boundaries

Trust boundaries are where uncontrolled input crosses into the semantic core:

| Boundary | What to validate |
|---|---|
| Manifest YAML → `DAGNode` | Required fields, `previous` refs exist, no cycles |
| `CalypsoResponse` at WS send | Correct shape before it leaves the kernel |
| `SessionEvent` at bus emit | Shape correct before broadcast |
| Plugin `PluginResult` return | StatusCode is valid enum, message is string |

**Files:**
- `src/dag/graph/parser/manifest.ts` — add Zod schema, validate raw YAML
- `src/calypso/protocol/types.ts` — add Zod schemas for `ServerMessage`
- `src/lcarslm/types.ts` — add Zod schema for `PluginResult`

### 3b. `fast-check` property tests for semantic cores

Property tests state invariants mathematically over generated inputs. They catch
edge cases that example tests cannot anticipate.

**Target invariants:**

`SessionPaths` / `MerkleEngine`:
- For any stage in the manifest, its resolved path always contains every ancestor
  stage ID in the correct topological order
- No stage ID appears twice in a resolved path
- The root stage (no `previous`) always resolves to a single-element path

`WorkflowAdapter` (`autoExecuteCompletion_resolve`):
- The auto-execute set is exactly the set of reachable no-commands stages from any
  given position
- The auto-execute set is always a subset of the manifest stage IDs

`IntentParser` (FastPath):
- For any input that exactly matches a manifest command phrase, the fast path returns
  that command with `isModelResolved: false`
- For any input that matches no manifest command, the fast path returns null

**New test files:**
- `src/dag/bridge/SessionPaths.property.test.ts`
- `src/dag/bridge/WorkflowAdapter.property.test.ts`
- `src/lcarslm/routing/IntentParser.property.test.ts`

---

## Execution Order and Rationale

```
Piece 1 (EventEmitter)   →  Piece 2 (Session Bus)   →  Piece 3 (Defenses)
    2-3 hrs                    2-3 days                    2-3 days
```

Piece 1 first because it eliminates a custom component before building anything new
on top of it. The Session Bus is built on EventEmitter from day one, not migrated later.

Piece 3 after Piece 2 because the SessionEvent and updated boundary surfaces are stable
targets for Zod schemas. Writing Zod schemas for types that are still evolving wastes
effort.

---

## Verification (applies to all three pieces)

```bash
npx tsc --noEmit          # Always clean
npx vitest run            # 424+ pass (target: 445+ after all new tests)
```

Manual smoke (Piece 2):
1. Start server and connect TUI + WUI simultaneously
2. Type `search histology` in TUI → WUI receives `session_event` with full response
3. Click "gather" pill in WUI → TUI renders full gather telemetry + output
4. Both surfaces show consistent session state at all times
