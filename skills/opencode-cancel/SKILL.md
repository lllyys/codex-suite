---
name: opencode-cancel
description: Safely cancel a Codex Suite OpenCode job using verified process identity and confirmed exit when the user requests stopping an OpenCode job or invokes $opencode-cancel.
---

# OpenCode delegation

Locate the installed `ask-opencode` directory beside this skill and set `OPENCODE_SKILL_DIR` to its absolute path. Read [the shared workflow](../ask-opencode/references/delegation-workflow.md) for defaults, lifecycle flags, permission limits, failure handling, and result verification.

Run from the target workspace:

```bash
node "$OPENCODE_SKILL_DIR/scripts/opencode-jobs.mjs" cancel
```

Pass an exact job ID or unique prefix if specified. Without a reference, add lifecycle `--session-id <id>`; ambiguity requires selecting a job. Always preserve `--state-data <path>`. The controller verifies PID and OS start time before signalling and confirms exit. Report `outcome`, `terminated`, and `detail`; a cancellation record with `terminationConfirmed: false` does not prove the worker stopped. Do not kill processes by name or revert partial edits. Inspect `$opencode-status <jobId>` after cancellation when needed.
