---
name: grok-result
description: Fetch the persisted output and metadata of a completed, failed, cancelled, or stalled Codex Suite Grok job by exact ID, unique prefix, or latest finished job. Use when the user asks for a background Grok result or explicitly invokes $grok-result.
---

# Grok Job Result

Set `SKILL_DIR` to the absolute directory containing this `SKILL.md`, then run from the target workspace:

```bash
node "$SKILL_DIR/../ask-grok/scripts/grok-jobs.mjs" result [job-id]
```

When the SessionStart hook supplied a session id and plugin state path, add `--session-id <id> --state-data <path>` for the no-ID form. Keep `--state-data` with an explicit ID, which intentionally resolves across retained sessions.

With no ID, resolve the latest finished job. With an ID, accept an exact or unambiguous prefix. Relay resolution errors verbatim; they distinguish running, unknown, ambiguous, and absent jobs.

The JSON contains `job` and `stored`. If `stored` is missing, report that its result artifact may have been pruned. Otherwise show:

- Job ID, kind, status, duration, and Grok thread ID.
- `stored.rawOutput`, or `stored.error` for a failure.
- `stored.resumed` when present.
- `stored.toolCalls`.

For an `implement` job, do not treat Grok's output as completion evidence. Inspect the workspace diff and run the verification steps required by `$grok-implement` before reporting implementation complete.

For an audit or verification job, preserve partial output when the status is `failed` or `stalled` and label it partial.
