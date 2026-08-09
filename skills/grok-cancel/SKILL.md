---
name: grok-cancel
description: Safely cancel an active Codex Suite Grok job using persisted process identity, process-tree termination, and confirmed exit. Use when the user asks to stop or cancel a Grok background job or explicitly invokes $grok-cancel.
---

# Cancel Grok Job

Set `SKILL_DIR` to the absolute directory containing this `SKILL.md`, then run from the target workspace:

```bash
node "$SKILL_DIR/../ask-grok/scripts/grok-jobs.mjs" cancel [job-id]
```

When SessionStart supplied a plugin state path, add `--state-data <path>` so cancellation resolves the same job store as the runner.

With no ID, cancel only when exactly one job is active. With an ID, accept an exact or uniquely matched prefix. If multiple jobs are active, run `$grok-status` and ask which ID to cancel.

Never call `kill` directly. The controller verifies the recorded PID and OS process start time before signalling, terminates the process group, escalates `SIGTERM → SIGKILL`, and records whether exit was confirmed.

Report the actual `outcome`:

- `terminated`: cancelled and confirmed exited.
- `already-exited`: marked cancelled; the process was already gone or the PID was recycled.
- `no-pid`: marked cancelled, but no worker PID was available.
- `unverifiable`: marked cancelled but not signalled because identity could not be proven.
- `signal-failed` or `not-confirmed`: marked cancelled, but warn that the process may still be alive.
- `already-finished`: the job reached a terminal state while cancellation was in flight.

Finish by suggesting `$grok-status` to confirm the updated queue.
