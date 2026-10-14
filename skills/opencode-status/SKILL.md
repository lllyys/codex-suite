---
name: opencode-status
description: Show active and recent Codex Suite OpenCode jobs, progress, duration, and session IDs when the user requests OpenCode job status or invokes $opencode-status.
---

# OpenCode delegation

Locate the installed `ask-opencode` directory beside this skill and set `OPENCODE_SKILL_DIR` to its absolute path. Read [the shared workflow](../ask-opencode/references/delegation-workflow.md) for defaults, lifecycle flags, permission limits, failure handling, and result verification.

Run from the target workspace:

```bash
node "$OPENCODE_SKILL_DIR/scripts/opencode-jobs.mjs" status
```

An optional exact job ID or unique prefix shows one job. `--all` shows all retained OpenCode jobs across sessions. Without a reference, add lifecycle `--session-id <id>` and always preserve `--state-data <path>`. Show active jobs, latest finished, recent jobs, elapsed time, model, summary, session ID, and available progress. For finished jobs, include `$opencode-result <jobId>`. If `--json` was requested, return JSON unchanged. OpenCode commands exclude Grok jobs.
