---
name: codex-suite-init
description: Initialize or regenerate `.codex-suite.md` for the current project with a validated Grok model, reasoning effort, audit depth, audit focus, skip patterns, and detected project instructions. Use when the user asks to initialize, configure, set up, or reconfigure codex-suite or project-specific Codex-to-Grok settings, or explicitly invokes $codex-suite-init.
---

# Codex Suite Init

Initialize only the current project's Codex → Grok configuration. Do not install
or remove plugins, modify Codex's own model settings, or create MCP bridges.

Set `SKILL_DIR` to this skill's absolute directory and `GROK_SKILL_DIR` to
`$SKILL_DIR/../ask-grok`.

## 1. Resolve the project and existing config

Run:

```bash
node "$SKILL_DIR/scripts/init-config.mjs" --cwd "<current workspace>" --inspect
```

The script resolves the Git root when available and detects stack markers,
source directories, and a test command.

If `.codex-suite.md` exists:

- With `--force` or an explicit request to regenerate, read the existing file,
  summarize the values that will be replaced, and continue.
- Otherwise ask the user to choose `Show`, `Regenerate`, or `Cancel`. Never
  overwrite merely because the skill was invoked.

## 2. Discover valid Grok settings

Run the local-only preflight; it does not make a model request:

```bash
node "$GROK_SKILL_DIR/scripts/grok-preflight.mjs"
```

Stop with its actionable error when `status` is `error`. Never invent a model
slug or effort. Use only values returned in `models`, `reasoning_efforts`, and
`sandbox_levels`.

## 3. Select settings

Parse optional invocation flags:

- `--defaults`: choose preflight's default model, `high` effort when supported
  (otherwise the highest supported effort), `mini`, balanced focus, and
  per-skill sandbox defaults without asking.
- `--model <slug|latest>`: concrete model pin, or dynamic `latest`.
- `--effort <level>`: Grok reasoning effort.
- `--audit-type mini|full`.
- `--focus balanced|security-first|performance-first|quality-first`.
- `--sandbox per-skill|read-only|workspace-write|danger-full-access`.
- `--force`: permit replacement after the existing file has been shown.

Explicit flags win. Without `--defaults`, ask only for unresolved choices:

1. Model: recommend preflight's default; when only one model exists, select it
   and disclose the selection.
2. Effort: recommend `high`.
3. Audit type: recommend `mini`.
4. Audit focus: recommend `balanced`.
5. Sandbox: recommend `per-skill`, which leaves reviews read-only and
   implementation workspace-write. Confirm separately before
   `danger-full-access`.

## 4. Generate deterministically

Run the bundled writer with the resolved absolute project path and selected
values:

```bash
node "$SKILL_DIR/scripts/init-config.mjs" \
  --cwd "<absolute project>" \
  --model "<model>" \
  --effort "<effort>" \
  --audit-type "<mini|full>" \
  --focus "<focus>" \
  --sandbox "<sandbox>"
```

Add `--force` only after replacement was authorized. The script writes
`.codex-suite.md` atomically. `per-skill` intentionally omits `Default sandbox`
so each workflow keeps its least-permissive built-in setting.

## 5. Verify and report

Run:

```bash
node "$GROK_SKILL_DIR/scripts/grok-config.mjs" "<absolute project>"
```

Confirm that the parsed model, effort, audit type, optional sandbox, audit
focus, skip patterns, and project instructions match the selection. Report the
absolute config path and detected project/test information. Suggest testing
with:

```text
$ask-grok Give one concise observation about this project.
```

Do not commit or push the generated project config unless separately requested.
