# Shared OpenCode 2 workflow

Use the bundled `scripts/opencode-preflight.mjs`, `opencode-runner.mjs`, and `opencode-jobs.mjs` from `ask-opencode`, not a Grok runner. OpenCode uses CLI JSON events, not ACP.

## Defaults and configuration

The runner uses `opencode` from PATH. Set `CODEX_SUITE_OPENCODE_BIN` only for an explicit alternate executable. OpenCode 2 is required. Preflight checks version, required run flags, and `models --standalone`; it sends no model prompt and does not prove provider authentication or inference availability.

Use `$opencode-init` to generate the `opencode` section in `.codex-suite.json` with project instructions, or edit it manually. Existing settings are preserved unless regeneration is requested; the `grok` section is preserved. `--migrate` copies legacy `.codex-suite.opencode.json` settings unchanged and retains that file.

The built-in model is `opencode/muse-spark-1.3-contributor-free`. The optional `opencode` object accepts `model`, positive integer `timeoutMs`, and string `instructions`. If the section is absent, the runner reads legacy `.codex-suite.opencode.json`. A present section is authoritative; missing fields use defaults, not legacy values. Invalid unified JSON is an error. Pass the same explicit `--model <provider/model>` to preflight and the runner when overriding model selection. CLI flags override project settings; these override built-in defaults. Omit `--timeout-ms` by default: use the project's `opencode.timeoutMs`, or the runner's 900000 ms (15-minute) fallback when unset. This is a bounded deadline, not unlimited execution. Pass an explicit positive timeout only when requested or justified by the task, and report the reason for overriding the project setting. Grok settings remain under `grok` or legacy `.codex-suite.md` and never supply OpenCode model settings. Never silently fall back to a paid model. If the free model disappears, report the problem and use another model only when selected by the user.

## Execution and permissions

The runner submits stdin to `opencode run --standalone --format json`, selects `explore` for consultation/review and `build` for implementation, and never passes `--auto`. Standalone uses a private server so cancellation does not depend on the shared user service. Explore is the built-in read/search agent; local agent overrides, plugins, MCP tools, and provider settings still apply. Consultation includes a no-mutation instruction, but is not an OS sandbox or a guarantee against customized tools. Implementation uses OpenCode's configured permissions; unattended permission requests may fail or time out. Report those failures rather than broadening permissions automatically.

Use `--cwd <absolute-workspace>` when needed. Prompts must use `--prompt-stdin`, with quoted heredocs or structured subprocess stdin to avoid shell expansion. A prompt is limited to 1 MiB, output to 16 MiB. Modes are `consult`, `review`, and `implement`. Preserve existing user changes; no commit, push, publish, unrelated edits, or recursive agent delegation.

## Lifecycle and background jobs

When SessionStart supplies values, pass `--host-session-id <id> --state-data <path>` to every runner call. Pass the same `--state-data` to every controller call and `--session-id <id>` to no-reference status, result, and cancel calls. Explicit IDs search OpenCode jobs across sessions; `status --all` also crosses sessions. Jobs share private workspace-keyed storage with Grok but controllers filter by backend.

Foreground is the default (`--wait` is also accepted). Add `--background` when requested, immediately return the queued job ID, and point to `$opencode-status`, `$opencode-result`, and `$opencode-cancel`. Background completion is not implementation verification. SessionEnd cleanup handles both backends, subject to trusted lifecycle hooks.

### Monitoring and result retrieval

For nonblocking coordination with native completion delivery, let a host subagent own a foreground OpenCode runner and return its result to the main agent. The main agent can continue independent work and receive the subagent's completion through the host, without polling OpenCode job status. This does not establish that the host will send a user-visible message after the main turn has ended.

For detached jobs, add `--background --notify` only when the user requests a desktop completion alert. On macOS the worker makes one best-effort notification request after persisting a completed or failed result; the alert contains only the job ID and status. It does not poll, inject a prompt, wake Codex, or retrieve the answer. Notification settings may suppress it; other platforms skip it. Notification failure leaves the job result unchanged. Use `$opencode-result <jobId>` to retrieve the saved answer. Cancellation and session cleanup do not send completion alerts.

Distinguish a background handoff from an actively monitored run. When monitoring is requested, use host completion notifications if available; otherwise poll `status <jobId>` at reasonable intervals while the host session remains active. Do not promise automatic notifications or unattended retrieval when the host cannot provide them. As soon as monitoring observes a terminal state, call `result <jobId>` and summarize the answer or failure without waiting for another user status request.

Report elapsed time, current state, and the latest available progress separately from stall concerns. A quiet log or delayed first text does not establish a stalled task; distinguish that observation from a deadline failure, provider error, or confirmed process exit. Do not shorten the timeout or cancel solely because text has not appeared.

For timing investigations, use job metadata for start and completion and timestamped log events for first text receipt when available. Record when the host observes completion and retrieves the result; report completion-to-retrieval delay separately from execution duration. Mark missing timestamps as unavailable. Log event times describe local receipt, not provider inference timing; do not infer streaming latency from the final answer alone.

## Results and failure handling

The runner emits JSON with `jobId`, `status`, `threadId` (OpenCode `ses_...` session ID), `rawOutput`, `toolCalls`, and `error`. A completed process must return nonempty text and no error event. Resume with `--resume <threadId>` only for the same task/mode; fresh verification omits it.

Report CLI/provider failures, partial output, job/session IDs, and unresolved work. Do not silently retry, switch backend, choose a paid model, or claim verification succeeded. Inspect and test implementation changes independently. Cancellation checks process identity and records whether exit was confirmed; preserve partial edits.

For recurring failures, compare the direct OpenCode CLI with the Codex Suite runner before attributing the problem to the provider or increasing deadlines. Within the authorized scope, keep the model, prompt, working directory, agent mode, permissions, and relevant CLI options equivalent, and compare exit/error output and timing. If another invocation is not authorized, report that diagnostic as the next step. A direct success alone does not prove the runner is faulty when those conditions differ.
