---
name: grok-init
description: Initialize, inspect, regenerate, or migrate the Grok section of .codex-suite.json when the user requests Grok project setup for Codex Suite or invokes $grok-init.
---

# Grok Init

Follow the [shared Grok initialization workflow](../codex-suite-init/SKILL.md).
Set `SKILL_DIR` to the absolute `../codex-suite-init` directory for its commands.
`$grok-init` is the preferred name; `$codex-suite-init` remains compatible.
Both use the same deterministic writer. A direct CLI entry point is also
available here at `scripts/init-config.mjs` with identical flags.

Write only the `grok` section in `.codex-suite.json`, preserving `opencode`.
Keep legacy `.codex-suite.md` as a read fallback when the section is absent.
`--migrate` copies its supported values unchanged; `--force` regenerates only
Grok settings. Preserve existing configuration by default. Do not change
OpenCode credentials or native CLI settings. Do not commit generated configuration unless requested.
