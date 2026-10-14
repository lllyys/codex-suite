---
name: opencode-result
description: Fetch output and metadata from a finished Codex Suite OpenCode job by ID, unique prefix, or latest finished job when the user requests an OpenCode result or invokes $opencode-result.
---

# OpenCode delegation

Locate the installed `ask-opencode` directory beside this skill and set `OPENCODE_SKILL_DIR` to its absolute path. Read [the shared workflow](../ask-opencode/references/delegation-workflow.md) for defaults, lifecycle flags, permission limits, failure handling, and result verification.

Run from the target workspace:

```bash
node "$OPENCODE_SKILL_DIR/scripts/opencode-jobs.mjs" result
```

An optional exact job ID or unique prefix selects one job. Without a reference, add lifecycle `--session-id <id>`; always preserve `--state-data <path>`. If still active, report that and use `$opencode-status`; do not treat a saved background request as an answer. Show status, model, job/session IDs, final `stored.rawOutput`, errors, and any unconfirmed cancellation. For an implementation result, independently inspect changes and run relevant checks before claiming success. Return JSON unchanged when requested.
