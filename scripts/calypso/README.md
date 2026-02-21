# Calypso Scripts (`.calypso.yaml`)

This directory contains script definitions for repeatable Calypso CLI execution.
The scripting layer exists to preserve deterministic workflow behavior while
removing the need to retype long command sequences during development and oracle
validation.

Scripts are executed through `/run <script>`, and discovery remains available via
`/scripts`. Script resolution follows a deterministic lookup chain: direct path
reference, extension-appended reference, and finally lookup under
`scripts/calypso/`.

```bash
/scripts
/run <script>
```

The runtime supports both legacy line-command mode and structured step mode.
Structured mode is preferred for long-lived automation because it keeps dependency
flow explicit through prompts, variable interpolation, and output aliasing.

```yaml
script: harmonize
version: 1
description: Generic harmonization flow with interactive search.
defaults:
  project_name: histo-exp1
steps:
  - id: s1_search
    action: command
    params:
      query: "histology"
      command: "search ${query}"
  - id: s2_add
    action: command
    params:
      dataset: "ds-006"
      command: "add ${dataset}"
  - id: s3_rename
    action: command
    params:
      project: "${answers.project_name ?? defaults.project_name}"
      command: "rename ${project}"
  - id: s4_harmonize
    action: command
    params:
      command: "harmonize"
```

Typical operator flow includes listing scripts, inspecting a specific definition,
running dry mode, and then executing the script against the active session.

```bash
/scripts
/scripts hist-harmonize
/run --dry hist-harmonize
/run hist-harmonize
/run scripts/calypso/hist-harmonize.calypso.yaml
```

The starter set includes interactive harmonization and deterministic histology
harmonization variants. The same script execution path is reachable through
natural language requests in CalypsoCore, which means conversational execution
and explicit `/run` execution converge on the same control plane.
