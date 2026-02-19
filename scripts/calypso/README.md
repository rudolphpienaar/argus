# Calypso Scripts (`.calypso.yaml`)

The Calypso WebSocket CLI (`make calypso-ws`) supports script-driven execution so repeatable workflows can be invoked as named operational units instead of retyped command sequences. In practice, the script system gives advanced users a fast path while preserving deterministic behavior and observable state transitions.

A script is invoked through `/run <script>`, and discovery is available through `/scripts`. When CALYPSO resolves a script reference, it first checks direct paths, then tries the same reference with `.calypso.yaml` appended, and finally searches under `scripts/calypso/` using both bare and extension-qualified forms.

```bash
/scripts
/run <script>
```

The runtime accepts two authoring styles. Legacy command mode treats each non-comment line as a command and executes fail-fast. Structured mode defines explicit steps with actions and parameters. Structured scripts support runtime prompts via `?`, reference interpolation via `${...}`, and step output aliasing so later actions can consume earlier results.

```yaml
script: harmonize
version: 1
description: Generic harmonization flow with interactive search.
defaults:
  project_name: histo-exp1
steps:
  - id: s1_search
    action: search
    params:
      query: "?"
    outputs:
      alias: search_results
  - id: s2_select
    action: select_dataset
    params:
      from: "${search_results}"
      strategy: ask
    outputs:
      alias: selected_dataset
  - id: s3_add
    action: add
    params:
      dataset: "${selected_dataset.id}"
  - id: s4_rename
    action: rename
    params:
      project: "${answers.project_name ?? defaults.project_name}"
  - id: s5_harmonize
    action: harmonize
    params: {}
```

Typical usage flows include script listing, inspection, dry-run, and execution.

```bash
/scripts
/scripts hist-harmonize
/run --dry hist-harmonize
/run hist-harmonize
/run scripts/calypso/hist-harmonize.calypso.yaml
```

Starter scripts in this directory include `harmonize.calypso.yaml` for interactive cohort setup, `hist-harmonize.calypso.yaml` for deterministic histology setup, `fedml-quickstart.calypso.yaml` for local training acceleration, and `fedml-fullrun.calypso.yaml` for end-to-end federated simulation.

The same capability is reachable via natural language through CalypsoCore, so conversational requests for available scripts or script execution map to the same control plane.
