---
name: ask-opencode
description: Delegate a consultation, code review, debugging analysis, or second opinion to OpenCode 2 when the user asks to consult OpenCode or invokes $ask-opencode.
---

# OpenCode delegation

Locate the installed `ask-opencode` directory beside this skill and set `OPENCODE_SKILL_DIR` to its absolute path. Read [the shared workflow](../ask-opencode/references/delegation-workflow.md) for defaults, lifecycle flags, permission limits, failure handling, and result verification.

By default, a native host subagent owns the foreground OpenCode call and returns its result through native completion delivery. The coordinator stays available and does not poll job status. If you are already that delegated worker, run the commands below directly; do not delegate again. Without native subagents, use `--background` and return the job ID. Have the main session wait directly only when the user explicitly requests it.

Use `--mode consult` for analysis or `--mode review` for a findings-first review. Include the user's question, relevant paths, known constraints, and requested output in the prompt. Omit `--model` to use the configured free default. Omit `--timeout-ms` to honor project configuration and the runner fallback; override it only when requested or justified by the task. Run preflight before delegation.

The owning worker runs:

```bash
node "$OPENCODE_SKILL_DIR/scripts/opencode-preflight.mjs"
node "$OPENCODE_SKILL_DIR/scripts/opencode-runner.mjs" --mode consult --prompt-stdin <<'PROMPT'
<focused task with context and scope>
PROMPT
```

Use a detached job when explicitly requested or as the no-subagent fallback. Add `--notify` only for a requested macOS desktop alert; it does not wake Codex or retrieve the answer. Native subagent completion does not guarantee a user-visible message after the main turn has ended. See the shared workflow for result delivery and notification limits. Use `--resume <threadId>` only to continue the same task and permission mode. Evaluate the answer against repository evidence before recommending changes. Report the model, job ID, session ID, answer, and material limitations.
