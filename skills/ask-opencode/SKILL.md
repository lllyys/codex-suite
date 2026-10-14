---
name: ask-opencode
description: Delegate a consultation, code review, debugging analysis, or second opinion to OpenCode 2 when the user asks to consult OpenCode or invokes $ask-opencode.
---

# OpenCode delegation

Locate the installed `ask-opencode` directory beside this skill and set `OPENCODE_SKILL_DIR` to its absolute path. Read [the shared workflow](../ask-opencode/references/delegation-workflow.md) for defaults, lifecycle flags, permission limits, failure handling, and result verification.

Use `--mode consult` for analysis or `--mode review` for a findings-first review. Include the user's question, relevant paths, known constraints, and requested output in the prompt. Omit `--model` to use the configured free default. Run preflight before delegation.

```bash
node "$OPENCODE_SKILL_DIR/scripts/opencode-preflight.mjs"
node "$OPENCODE_SKILL_DIR/scripts/opencode-runner.mjs" --mode consult --prompt-stdin <<'PROMPT'
<focused task with context and scope>
PROMPT
```

Add `--background` only when requested; otherwise wait for completion. Use `--resume <threadId>` only to continue the same task and permission mode. Evaluate the answer against repository evidence before recommending changes. Report the model, job ID, session ID, answer, and material limitations.
