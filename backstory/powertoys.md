# Power User Workflows

This document describes how experienced operators compress repetitive CALYPSO interactions into reusable flows. The goal is speed without loss of traceability: each shortcut still materializes state, emits visible progress, and remains compatible with the same deterministic command model used in normal operation.

## External Script Flows (`.clpso`)

Power users can package repeatable command sequences into `.clpso` files and execute them with `/run <script>`. CALYPSO resolves script references from direct paths and from `scripts/calypso/`, so a script can be run either by explicit path or by short name. The `/scripts` command exposes discoverable script metadata, and `/run --dry <script>` previews execution without mutation.

```text
/scripts
/run hist-harmonize
/run scripts/calypso/hist-harmonize.clpso
```

Natural language reaches the same control plane. Requests like "what scripts are available?" and "run the hist-harmonize script" are routed into the same script catalog and execution path.

## Transcript Paste Replay

`calypso-cli` can ingest mixed transcript text so users can replay prior sessions quickly. The parser executes command lines directly, accepts prompt-prefixed lines such as `user@CALYPSO:[...]> command`, and ignores narrative/output lines that should not be executed. This keeps pasted logs useful as operational macros instead of turning them into command noise.

## Batch and Jump Shortcuts

When a full script is unnecessary, `/batch` and `/jump` can fast-forward a workspace to a requested stage using deterministic stage actions.

```text
/batch train ds-006
/jump harmonize ds-006
```

These commands are intentionally explicit about target stage so the transition is auditable and predictable.

## Testing Value

Power scripts are also a practical test authoring substrate. Teams can design a manual flow once, iterate on it in CLI sessions, and then promote that same flow into ORACLE scenarios with minimal translation. In other words, the fastest way to reproduce behavior during development is often the same way to formalize it for regression testing.
