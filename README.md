# codex-suite

A small Codex plugin that lets Codex delegate work to Grok Build over the
[Agent Client Protocol](https://agentclientprotocol.com/). This release contains
only Codex → Grok lanes.

## What it includes

- `$ask-grok`, a general delegation skill for reviews and second opinions
- `$grok-implement`, a plan → implementation → independent Codex verification workflow
- `$grok-audit-fix`, a durable audit → fix → fresh Grok verification loop
- `$grok-status`, `$grok-result`, and `$grok-cancel` for persistent background jobs
- plugin-bundled `SessionStart` / `SessionEnd` hooks for session-scoped jobs and safe cleanup
- `.codex-suite.md` defaults, audit focus, skip patterns, and project-instruction injection
- a local preflight that checks the Grok binary, authentication, and cached models without sending a model request
- a dependency-free Node.js ACP client using `initialize → session/new|load → session/prompt`
- streamed answer collection, session resume, bounded timeouts, and structured JSON output
- `read-only`, `workspace-write`, and `danger-full-access` permission profiles
- workspace path containment for ACP file operations outside danger-full-access mode

## Requirements

- Node.js 18.18 or newer
- [Grok Build](https://x.ai/cli) installed and authenticated with `grok login`, or `XAI_API_KEY` set
- a Codex build with plugin and skill support

## Try the runner locally

The preflight is local and does not make a model request:

```bash
npm run preflight
```

Run a read-only delegation:

```bash
node skills/ask-grok/scripts/grok-runner.mjs \
  --sandbox read-only \
  --prompt-stdin <<'PROMPT'
Review the current changes for correctness bugs. Return findings with file paths.
PROMPT
```

The runner prints one JSON object:

```json
{
  "jobId": "grok-...",
  "status": "completed",
  "threadId": "session-id",
  "rawOutput": "Grok's answer",
  "toolCalls": 2
}
```

Continue the same Grok conversation with `--resume <threadId>`. Add `--model`
or `--effort` to override Grok's configured defaults.

## Codex skills

Ask Grok for a focused opinion:

```text
$ask-grok Review the current changes for correctness bugs.
```

Delegate an agreed plan and have Codex verify the result:

```text
$grok-implement Implement PLAN.md.
```

Run the audit/fix workflow. If no audit depth is configured, the skill asks you
to choose Mini (recommended) or Full; Codex is the default fixer:

```text
$grok-audit-fix
$grok-audit-fix src/payments --full --severity=high --fixer=grok
```

Audit findings are persisted under `.codex-suite/audits/` before any fix. The
file remains the source of truth for per-finding status across up to three
fix/verify rounds.

Optional `.codex-suite.md` configuration follows the reference layout:

````markdown
## Defaults
- **Default model**: latest
- **Default effort**: high
- **Default audit type**: mini
- **Default sandbox**: workspace-write

## Audit Focus
```text
Give equal attention to all audit dimensions.
```

## Skip Patterns
```text
vendor/
dist/
```

## Project-Specific Instructions
```text
Follow existing project conventions.
```
````

Explicit user choices override project configuration, which overrides each
skill's built-in recommendation.

## Background jobs

Add `--background` to a direct delegation or implementation:

```text
$ask-grok Review the current branch --background
$grok-implement Implement PLAN.md --background
```

The call returns a `jobId` immediately. Manage it with:

```text
$grok-status
$grok-status <jobId>
$grok-result <jobId>
$grok-cancel <jobId>
```

Jobs transition through `queued → running → completed|failed|stalled|cancelled`.
The controller stores model settings, phase, deadline, PID and OS process start
time, progress logs, Grok thread ID, and the final result. Cancellation verifies
process identity before signalling the process group, then escalates from
`SIGTERM` to `SIGKILL` only if necessary.

Inside an enabled plugin session, the lifecycle hook routes state to Codex's
private `PLUGIN_DATA` directory. Direct runner usage falls back to the private
system-temporary path `codex-suite/state`; set `CODEX_SUITE_DATA` or pass
`--state-data` to choose another persistent private root. State is keyed by the
canonical workspace path. Directories are hardened to `0700`; state, logs, and
result files use `0600`. The newest 50 jobs are retained, while active jobs are
never pruned.

The bundled lifecycle hook supplies the current Codex session ID to the skills.
When the main thread ends, it removes terminal jobs for that session and safely
terminates active workers whose process identity can be proven. Jobs that cannot
be safely signalled remain recorded as unconfirmed cancellations. After install
or hook changes, review and trust the plugin hook with `/hooks`; Codex skips
untrusted command hooks by design.

## Install during development

This repository is the plugin root. Add it to a Codex marketplace (or place it
under an existing local marketplace's `plugins/codex-suite` path), then run:

```bash
codex plugin add codex-suite@<marketplace-name>
```

Start a new Codex thread after installing or updating the plugin so the
`$ask-grok` skill is discovered.

## Security model

`read-only` rejects ACP permission requests and client-side writes.
`workspace-write` approves operations but keeps ACP file access inside the
workspace. `danger-full-access` removes that containment and must be selected
explicitly.

Grok can also execute its own tools. If `~/.grok/config.toml` globally sets
`permission_mode = "always-approve"`, those tools may be approved before the
ACP client sees a permission request. Consequently, `read-only` is best-effort,
not an operating-system sandbox.

## Credits

The ACP lane, the `implement` and `audit-fix` workflows, and the persistent job
controller are adapted from
[xiaolai/cc-suite](https://github.com/xiaolai/cc-suite). Claude-specific entry
points are mapped to Codex skills, and the delegated worker is Grok Build.
