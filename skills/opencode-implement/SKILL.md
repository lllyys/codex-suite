---
name: opencode-implement
description: Delegate an agreed implementation plan to OpenCode 2 and independently inspect and verify its workspace changes when the user requests OpenCode implementation or invokes $opencode-implement.
---

# OpenCode delegation

Locate the installed `ask-opencode` directory beside this skill and set `OPENCODE_SKILL_DIR` to its absolute path. Read [the shared workflow](../ask-opencode/references/delegation-workflow.md) for defaults, lifecycle flags, permission limits, failure handling, and result verification.

Capture `git status --short` and preserve pre-existing changes. Give OpenCode the complete plan, scope, protected paths, and required validation. State the working directory and selected model before sending.

```bash
node "$OPENCODE_SKILL_DIR/scripts/opencode-preflight.mjs"
node "$OPENCODE_SKILL_DIR/scripts/opencode-runner.mjs" --mode implement --summary "implement: <task>" --prompt-stdin <<'PROMPT'
Implement every step of this plan. Preserve existing changes and unrelated files. Run relevant checks and report files changed, commands run, results, and unresolved steps. Do not commit, push, or publish.
<complete plan>
PROMPT
```

Use `--background` when requested and return the job ID with `$opencode-status`, `$opencode-result`, and `$opencode-cancel` commands. Retrieve the completed result before declaring implementation finished.

Inspect tracked diffs and untracked files against the baseline. Independently run relevant tests, build, typecheck, and lint. Resolve scoped defects and report remaining failures honestly. Do not commit, publish, or destructively revert unless separately requested.
