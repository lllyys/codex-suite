# Shared OpenCode 2 workflow

Use the bundled `scripts/opencode-preflight.mjs`, `opencode-runner.mjs`, and `opencode-jobs.mjs` from `ask-opencode`, not a Grok runner. OpenCode uses CLI JSON events, not ACP.

## Defaults and configuration

The runner uses `opencode` from PATH. Set `CODEX_SUITE_OPENCODE_BIN` only for an explicit alternate executable. OpenCode 2 is required. Preflight checks version, required run flags, and `models --standalone`; it sends no model prompt and does not prove provider authentication or inference availability.

Use `$opencode-init` to generate the `opencode` section in `.codex-suite.json` with project instructions, or edit it manually. Existing settings are preserved unless regeneration is requested; the `grok` section is preserved. `--migrate` copies legacy `.codex-suite.opencode.json` settings unchanged and retains that file.

The built-in model is `opencode/muse-spark-1.3-contributor-free`. The optional `opencode` object accepts `model`, positive integer `timeoutMs`, and string `instructions`. If the section is absent, the runner reads legacy `.codex-suite.opencode.json`. A present section is authoritative; missing fields use defaults, not legacy values. Invalid unified JSON is an error. Pass the same explicit `--model <provider/model>` to preflight and the runner when overriding model selection. CLI flags override project settings; these override built-in defaults. The timeout is 900000 ms. Grok settings remain under `grok` or legacy `.codex-suite.md` and never supply OpenCode model settings. Never silently fall back to a paid model. If the free model disappears, report the problem and use another model only when selected by the user.

## Execution and permissions

The runner submits stdin to `opencode run --standalone --format json`, selects `explore` for consultation/review and `build` for implementation, and never passes `--auto`. Standalone uses a private server so cancellation does not depend on the shared user service. Explore is the built-in read/search agent; local agent overrides, plugins, MCP tools, and provider settings still apply. Consultation includes a no-mutation instruction, but is not an OS sandbox or a guarantee against customized tools. Implementation uses OpenCode's configured permissions; unattended permission requests may fail or time out. Report those failures rather than broadening permissions automatically.

Use `--cwd <absolute-workspace>` when needed. Prompts must use `--prompt-stdin`, with quoted heredocs or structured subprocess stdin to avoid shell expansion. A prompt is limited to 1 MiB, output to 16 MiB. Modes are `consult`, `review`, and `implement`. Preserve existing user changes; no commit, push, publish, unrelated edits, or recursive agent delegation.

## Lifecycle and background jobs

When SessionStart supplies values, pass `--host-session-id <id> --state-data <path>` to every runner call. Pass the same `--state-data` to every controller call and `--session-id <id>` to no-reference status, result, and cancel calls. Explicit IDs search OpenCode jobs across sessions; `status --all` also crosses sessions. Jobs share private workspace-keyed storage with Grok but controllers filter by backend.

Foreground is the default (`--wait` is also accepted). Add `--background` when requested, immediately return the queued job ID, and point to `$opencode-status`, `$opencode-result`, and `$opencode-cancel`. Background completion is not implementation verification. SessionEnd cleanup handles both backends, subject to trusted lifecycle hooks.

## Results and failure handling

The runner emits JSON with `jobId`, `status`, `threadId` (OpenCode `ses_...` session ID), `rawOutput`, `toolCalls`, and `error`. A completed process must return nonempty text and no error event. Resume with `--resume <threadId>` only for the same task/mode; fresh verification omits it.

Report CLI/provider failures, partial output, job/session IDs, and unresolved work. Do not silently retry, switch backend, choose a paid model, or claim verification succeeded. Inspect and test implementation changes independently. Cancellation checks process identity and records whether exit was confirmed; preserve partial edits.
