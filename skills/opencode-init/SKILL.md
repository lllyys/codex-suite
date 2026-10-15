---
name: opencode-init
description: Initialize or regenerate project-specific OpenCode delegation settings in the opencode section of .codex-suite.json when the user requests OpenCode setup for Codex Suite or invokes $opencode-init.
---

# OpenCode Init

Create Codex Suite's project configuration for OpenCode 2. This config sets the
delegated model, timeout, and instructions. OpenCode manages its own provider
credentials and tool permissions; this skill does not change those settings.

Set `SKILL_DIR` to this skill's absolute directory and `OPENCODE_SKILL_DIR` to
`$SKILL_DIR/../ask-opencode`.

## Inspect the project

```bash
node "$SKILL_DIR/scripts/init-config.mjs" --cwd "<project>" --inspect
```

The writer resolves the Git root and detects the stack, source directories,
and test command. If the user requested `--inspect`, report this output and stop
without writing or running preflight. If the `opencode` section or legacy `.codex-suite.opencode.json` already exists, show the existing
settings and keep them by default. Replace only when the user requests
regeneration or supplies `--force`; never overwrite merely because init was
invoked. For legacy settings, `--migrate` copies supported fields unchanged into `opencode` and retains the old file. Do not combine migration with setting overrides or `--force`. A malformed legacy config can be explicitly regenerated; malformed unified JSON must be repaired because it may contain Grok settings.

## Select settings and check readiness

Use the free built-in model `opencode/muse-spark-1.3-contributor-free`, a
900000 ms timeout, and detected project instructions unless the user chooses
overrides. `--defaults` explicitly selects those defaults without questions.
Accept `--model <provider/model>`, `--timeout-ms <positive integer>`, and
`--instructions <text>` or `--instructions-file <path>`. Explicit flags win;
`--defaults` never authorizes replacing an existing file.

For `--migrate`, import the existing settings and verify locally without changing model selection; readiness checking is optional. For a new or regenerated config, check the chosen model before writing:

```bash
node "$OPENCODE_SKILL_DIR/scripts/opencode-preflight.mjs" --cwd "<project>" --model "<chosen model>"
```

Preflight sends no model prompt. If unavailable, report the CLI/provider error
and keep the user's selected model. Do not silently select a paid replacement.
Configuration creation can proceed offline when requested; disclose that model
readiness is unverified. For malformed legacy JSON, preview and regenerate with authorized `--force`, then run preflight afterward. Do not replace a malformed unified file.

## Write and verify

```bash
node "$SKILL_DIR/scripts/init-config.mjs" --cwd "<project>" --defaults
```

Add the chosen override flags. For multiline instructions, use structured
subprocess arguments or `--instructions-file`; avoid shell interpolation.
`--dry-run` returns the exact proposed JSON without writing. Add `--force`
only for an authorized replacement; it regenerates all three OpenCode fields rather
than merging existing settings, so carry forward values the user wants to keep.

The script runs locally without OpenCode or network access and writes only
the `opencode` section in `.codex-suite.json`, atomically under a shared writer lock, preserving `grok`. It leaves both legacy files and OpenCode's native config untouched. A section in the unified file overrides the entire legacy backend config; missing fields use built-in defaults.
Read the written JSON and confirm its `opencode` section matches the returned `selected` values.
Report its absolute path, model, timeout, project/test detection, and readiness.
Suggest `$ask-opencode Give one concise observation about this project.` as an
optional inference check. Do not commit or push project configuration unless
requested.
