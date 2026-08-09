---
name: ask-grok
description: Delegate a coding, debugging, implementation, review, or architecture task from Codex to Grok Build over ACP and return Grok's structured result. Use when the user explicitly asks Codex to ask, consult, delegate to, or get a second opinion from Grok, or explicitly invokes $ask-grok.
---

# Ask Grok

Use the bundled ACP runner. Do not substitute an HTTP API call or scrape interactive CLI output.

## Workflow

1. Set `SKILL_DIR` to the absolute directory containing this `SKILL.md`, then read [references/delegation-workflow.md](references/delegation-workflow.md). Apply its configuration priority, prompt, session, and failure-diagnostic rules.
2. Run the local readiness and configuration checks before the first delegation in a turn:

   ```bash
   node "$SKILL_DIR/scripts/grok-preflight.mjs"
   node "$SKILL_DIR/scripts/grok-config.mjs" "<absolute workspace>"
   ```

3. If preflight returns `status: "error"`, stop and report its actionable `error`. Do not start a model call.
4. Choose the least-permissive sandbox that can satisfy the request:
   - `read-only`: reviews, explanations, planning, and second opinions. This is the default.
   - `workspace-write`: only when the user asked Grok to edit or implement in the workspace.
   - `danger-full-access`: only when the user explicitly requests unrestricted access and accepts the risk.
5. Parse execution mode: `--background` starts a detached job; `--wait` or no mode flag waits in the foreground. Remove the mode flag from the delegated prompt.
6. Run the task. Pass the prompt on stdin so code and shell characters are not interpolated. Add `--host-session-id <id> --state-data <path>` when SessionStart supplied them:

   ```bash
   node "$SKILL_DIR/scripts/grok-runner.mjs" \
     --sandbox read-only \
     --kind grok \
     --summary "short task summary" \
     --timeout-ms 900000 \
     --prompt-stdin <<'CODEX_SUITE_GROK_PROMPT'
   Put the complete task, relevant paths, constraints, and expected output here.
   CODEX_SUITE_GROK_PROMPT
   ```

   Add `--background` before `--prompt-stdin` for detached execution.

7. Parse the single JSON object printed on stdout:
   - On `status: "queued"`, report `jobId` immediately and point to `$grok-status`, `$grok-result <jobId>`, and `$grok-cancel <jobId>`.
   - On `status: "completed"`, present `rawOutput` as Grok's delegated result and retain `threadId` when follow-up work is likely.
   - On `status: "failed"` or `status: "stalled"`, report `error` and label any `rawOutput` as partial.
   - If a resume call returns `resumed: false`, state that Grok started a fresh session.
8. Verify Grok's factual claims against the workspace before relying on them. After a write-capable foreground call, inspect the diff and run proportionate tests. For background write jobs, perform that verification when `$grok-result` retrieves completion. Grok's response is input to Codex's judgment, not evidence by itself.

## Options

Add options before `--prompt-stdin`:

- `--model <id>` selects a concrete model; preflight discovery is advisory and Grok performs final validation.
- `--effort none|minimal|low|medium|high|xhigh|max` selects reasoning effort.
- `--resume <threadId>` continues a prior ACP session.
- `--background` returns a job ID immediately; `--wait` is the foreground default.
- `--kind <label>` and `--summary <text>` label job status; skills should set these to meaningful values.
- `--host-session-id <id>` and `--state-data <path>` use the values supplied by the plugin SessionStart hook.
- `--cwd <path>` sets the workspace; default is the current Git root or current directory.
- `--debug` writes protocol metadata to stderr. It never prints prompt or answer content.

Foreground and background calls are both persisted. Job state and private `0600` result/log files live below `${CODEX_SUITE_DATA}/state` when set, otherwise in the system temporary directory under `codex-suite/state`.

Do not invoke this skill from inside a task already delegated to Grok. The runner also prepends a delegation boundary to prevent recursive hand-offs.

`read-only` denies client-side writes and permission requests, but Grok's global `permission_mode = "always-approve"` can pre-approve its own tools before the ACP client is asked. Treat this mode as best-effort rather than OS-level isolation.
