---
name: grok-implement
description: Delegate a complete implementation plan from Codex to Grok Build, let Grok edit the workspace over ACP, then have Codex inspect and verify the resulting changes. Supports foreground waiting and persistent background jobs. Use when the user explicitly asks Grok to implement, execute, or build from a plan, or explicitly invokes $grok-implement.
---

# Grok Implement

Treat Codex as the architect and verifier and Grok as the autonomous builder. Follow the reference workflow's plan resolution, settings selection, foreground/background execution, and post-run verification.

Set `SKILL_DIR` to this skill's absolute directory and `GROK_SKILL_DIR` to `$SKILL_DIR/../ask-grok`. Read `$GROK_SKILL_DIR/references/delegation-workflow.md` before selecting settings or calling the runner.

## 0. Parse execution mode

Remove the mode flag from the plan input:

- `--background`: start a detached runner and return its job ID.
- `--wait`: wait in the foreground.
- Neither: foreground by default.

## 1. Resolve the plan

- Existing file path: read it as the plan.
- Explicit missing path: report `Plan file not found: <path>` and stop.
- Inline text: use it directly.
- Empty input: use `PLAN.md` if present, otherwise ask the user for the plan.

Display a brief plan summary. If it exceeds 200 lines, warn that it may exceed the worker's context and suggest breaking it into phases.

## 2. Select settings

```bash
node "$GROK_SKILL_DIR/scripts/grok-preflight.mjs"
node "$GROK_SKILL_DIR/scripts/grok-config.mjs" "<absolute workspace>"
```

Apply the shared reference's explicit-user → project-config → built-in priority. The built-in recommendations are:

- Model: preflight's default.
- Effort: `medium`.
- Sandbox: `workspace-write`.

Confirm again before `danger-full-access`. Record `git status --short` as the pre-run baseline and preserve every pre-existing user change.

Before sending, display the plan summary, absolute working directory, model, effort, and sandbox. The runner automatically adds configured leave-untouched paths and project instructions.

## 3. Send the plan

Run the shared ACP client with `--kind implement`, a short summary, and a 15-minute deadline. Add `--background` only in background mode.

```bash
node "$GROK_SKILL_DIR/scripts/grok-runner.mjs" \
  --kind implement \
  --summary "implement: <brief plan summary>" \
  --model <chosen_model> \
  --sandbox <chosen_sandbox> \
  --effort <chosen_effort> \
  --timeout-ms 900000 \
  --prompt-stdin <<'CODEX_SUITE_IMPLEMENT_PROMPT'
Execute the following plan completely from start to finish in the current workspace.

IMPORTANT RULES:
- Implement every plan step. Do not skip anything.
- Preserve unrelated and pre-existing changes.
- Create required files, dependencies, code, and behavioral tests.
- Make scoped production-quality changes, not opportunistic refactors.
- If a step fails, debug failures caused by this work before moving on.
- Run final build, test, typecheck, and lint commands exposed by the project.
- Report files created, files modified, commands run, verification results, skipped steps, and unresolved issues.

THE PLAN:
<verbatim plan>
CODEX_SUITE_IMPLEMENT_PROMPT
```

When SessionStart supplied lifecycle values, add `--host-session-id <id> --state-data <path>` before `--prompt-stdin` as directed by the shared reference.

In background mode, return the queued `jobId` immediately with:

- `$grok-status <jobId>`
- `$grok-result <jobId>`
- `$grok-cancel <jobId>`

Do not claim implementation complete before retrieving and verifying the background result.

## 4. Verify results

For foreground completion, or after `$grok-result` reports a completed implementation job:

1. Compare `git status --short` with the baseline.
2. Inspect `git diff --stat`, the substantive diff, and untracked files.
3. Confirm every plan step is implemented or explicitly blocked.
4. Run relevant tests, build, typecheck, and lint independently.
5. Fix small in-scope defects directly; otherwise continue Grok with `--resume <threadId>`.
6. Never report success while relevant verification fails.

If Grok returns empty, incomplete, `failed`, or `stalled`, emit the shared Grok-unavailable diagnostic block, preserve partial output, then offer: implement directly with Codex (recommended), run preflight/connectivity diagnostics, or cancel. Do not retry or silently switch implementers.

## 5. Report

Include model, effort, sandbox, job ID, Grok thread ID, files created/modified, Grok's report, Codex's verification commands/results, and unresolved plan steps.

Offer the same follow-up choices as the reference workflow: inspect the changes, commit them, run additional tests, or recover from an unwanted implementation. Do not commit or revert on the user's behalf without a separate request; warn that destructive checkout would discard unrelated uncommitted work and prefer a targeted or stash-based recovery.

Do not commit, push, publish, or destructively revert unless separately requested.
