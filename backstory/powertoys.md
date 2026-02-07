# Power User Workflows

This page documents practical shortcuts for advanced Calypso CLI usage.

## External Script Flows (`.clpso`)

Use reusable command scripts to replay SeaGaP steps quickly.

Run a script:

```text
/run <script>
```

Examples:

```text
/run harmonize
/run scripts/calypso/harmonize.clpso
```

Script format:

- One command per line
- Blank lines ignored
- `#` starts a comment line
- Fail-fast execution (stop on first failed command)

Starter script:

- `scripts/calypso/harmonize.clpso`

## Transcript Paste Replay

You can paste mixed conversation blocks into `calypso-cli`.

The CLI will execute:

- raw command lines
- prompt-prefixed command lines like `user@CALYPSO:[...]> command`

The CLI ignores common output lines (`●`, `○`, `>>`, box drawing, training logs), so large pasted transcripts do not spam command-not-found errors.

## Batch/Jump Shortcuts

For deterministic fast-forwarding without a script:

```text
/batch <gather|harmonize|code|train> [dataset]
/jump  <gather|harmonize|code|train> [dataset]
```

Example:

```text
/batch train ds-006
```

## Testing Use

`.clpso` scripts are a practical bridge toward automated scenario testing:

- author a flow once
- run it manually in CLI during iteration
- reuse command sequence as ORACLE-style test input later
