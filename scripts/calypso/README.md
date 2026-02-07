# Calypso Scripts (`.clpso`)

`calypso-cli` supports external script execution with:

```bash
/run <script>
```

Lookup order for `<script>`:

1. Direct path (absolute or relative to current working directory)
2. Same path with `.clpso` extension appended
3. `scripts/calypso/<script>`
4. `scripts/calypso/<script>.clpso`

Script format:

- One command per line
- Blank lines are ignored
- Lines starting with `#` are comments
- Execution is fail-fast (stops at first failed command)

Examples:

```bash
/run harmonize
/run scripts/calypso/harmonize.clpso
```
