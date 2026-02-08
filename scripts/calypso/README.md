# Calypso Scripts (`.clpso`)

`calypso-cli` supports external script execution with:

```bash
/scripts
/run <script>
```

Lookup order for `<script>`:

1. Direct path (absolute or relative to current working directory)
2. Same path with `.clpso` extension appended
3. `scripts/calypso/<script>`
4. `scripts/calypso/<script>.clpso`

Script formats:

1. Legacy command mode (one command per line):
   - Blank lines are ignored
   - Lines starting with `#` are comments
   - Execution is fail-fast

2. Structured workflow mode (YAML-like):
   - Declarative `steps` with `action` + `params`
   - Param value `?` prompts the user at runtime
   - `${...}` references prior step outputs/defaults/answers
   - `select_dataset` supports explicit strategies (`ask`, `first`, `by_id`, `best_match`)

Structured example:

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

Examples:

```bash
/scripts
/scripts hist-harmonize
/run --dry hist-harmonize
/run hist-harmonize
/run scripts/calypso/hist-harmonize.clpso
```

Suggested starter scripts:

- `harmonize.clpso` — generic interactive harmonization (asks search term)
- `hist-harmonize.clpso` — deterministic histology harmonization path
- `fedml-quickstart.clpso` — harmonize + scaffold + local train
- `fedml-fullrun.clpso` — end-to-end through federated dispatch/compute

Natural language also works through CalypsoCore:

```text
what scripts are available?
can you run the hist-harmonize for me?
```
