---
name: grok-status
description: Show active and recent Codex Suite Grok jobs, including queued or running background work, progress, duration, thread IDs, and terminal status. Use when the user asks about Grok job progress or explicitly invokes $grok-status.
---

# Grok Job Status

Set `SKILL_DIR` to the absolute directory containing this `SKILL.md`, then run from the target workspace:

```bash
node "$SKILL_DIR/../ask-grok/scripts/grok-jobs.mjs" status
```

When the SessionStart hook supplied a session id and lifecycle state path, add `--session-id <id> --state-data <path>` unless the user passed `--all` or an explicit job ID. Keep `--state-data` for explicit IDs and `--all` so they read the same state store.

Arguments:

- No argument: show active jobs, latest finished, and up to eight recent finished jobs.
- `<job-id>`: show one exact or uniquely prefix-matched job with up to 20 recent log lines.
- `--all`: show all retained finished jobs instead of the default recent window.
- `--json`: return the command's JSON unchanged when the user requests machine-readable output.

Render the default result as:

```markdown
# Codex Suite Grok Job Status

## Active Jobs
| Job | Kind | Status | Phase | Elapsed | Thread ID | Summary |
|---|---|---|---|---|---|---|

## Latest Finished
<job, status, duration, thread ID, summary, and `$grok-result <job>`>

## Recent Jobs
<terminal jobs newest first>
```

For an active or failed job, include `progressPreview`. If no jobs exist, say so and suggest `$ask-grok ... --background` or `$grok-implement ... --background`.
