# codex-suite

A Codex plugin for delegating reviews, second opinions, implementation, and
repair work to **Grok Build** or **OpenCode 2**. Codex inspects delegated changes
and runs relevant checks before reporting implementation success.

Grok uses the [Agent Client Protocol](https://agentclientprotocol.com/) (ACP).
OpenCode uses its [CLI](https://opencode.ai/v2/docs/cli) with streamed JSON
output and a private server for each run. Install either backend or both.
OpenCode defaults to a free model.

## Skills

| Task | Grok Build | OpenCode 2 |
|---|---|---|
| Consultation and review | `$ask-grok` | `$ask-opencode` |
| Implement an agreed plan | `$grok-implement` | `$opencode-implement` |
| Audit, fix, and verify | `$grok-audit-fix` | `$opencode-audit-fix` |
| Active and recent jobs | `$grok-status` | `$opencode-status` |
| Retrieve a finished result | `$grok-result` | `$opencode-result` |
| Cancel a job safely | `$grok-cancel` | `$opencode-cancel` |
| Initialize project settings | `$codex-suite-init` | Optional JSON configuration |

Both backends support session resume, bounded timeouts, persistent background
jobs, and session cleanup through bundled lifecycle hooks. Their job controllers
show only their own backend's jobs.

## Requirements

- Node.js 18.18 or newer for the bundled scripts.
- A Codex surface that supports plugins. See the
  [official plugin documentation](https://learn.chatgpt.com/docs/plugins).
- For Grok: [Grok Build](https://x.ai/cli), authenticated through OAuth or
  `XAI_API_KEY`.
- For OpenCode: OpenCode 2 available as `opencode` on PATH. Provider credentials
  depend on the selected model. The integration was checked with v2.0.28.

## Install

### 1. Prepare your backend

For OpenCode, follow the [CLI documentation](https://opencode.ai/v2/docs/cli)
and check:

```bash
node --version
opencode --version
opencode models --standalone
```

The default is `opencode/muse-spark-1.3-contributor-free`. Free model availability
and quotas can change. If the selected model is unavailable, the integration
reports the problem; it never silently selects a paid replacement.

For Grok, install from the [xAI CLI page](https://x.ai/cli) and sign in:

```bash
node --version
grok --version
grok --oauth
```

Alternatively, expose `XAI_API_KEY` to the environment that launches Codex.
OpenCode does not require Grok installation or credentials.

### 2. Add the marketplace and plugin

```bash
codex plugin marketplace add lllyys/codex-suite --ref main
codex plugin add codex-suite@codex-suite
```

### 3. Enable the plugin and review the hooks

Start Codex and open `/plugins`. Enable **Codex Suite**, then use `/hooks` to
review and trust its bundled `SessionStart` and `SessionEnd` commands. Skills
can run without the hooks; automatic session scoping and cleanup require them.

Start a **new Codex session** after installation, updates, or hook changes so
Codex discovers the current skills and lifecycle instructions.

### 4. Verify the connection

Use the backend you installed:

```text
$ask-opencode Reply with exactly: opencode connection ok
```

```text
$ask-grok Reply with exactly: grok connection ok
```

The skills run preflight first. Preflight discovers models without sending a
model prompt; a successful response to the request verifies inference too.

## Quick start

Ask for a review or delegate an agreed plan:

```text
$ask-opencode Review the current changes for correctness bugs.
$opencode-implement Implement every step in PLAN.md.
$opencode-audit-fix
```

The corresponding Grok workflows are:

```text
$ask-grok Review the current changes for correctness bugs.
$grok-implement Implement every step in PLAN.md.
$grok-audit-fix
$grok-audit-fix src/payments --full --severity=high --fixer=grok
```

Implementation workflows preserve existing changes and require independent
Codex verification. Audit-fix workflows persist findings under
`.codex-suite/audits/` before fixing, default to Codex as fixer, and run at most
three fix/verify rounds. OpenCode's full audit-fix cycle runs in the foreground;
a background review must be retrieved before fixes begin.

Natural-language requests such as “Ask OpenCode to review these changes” also
work. Explicit `$skill-name` invocation makes the backend choice clear.

## Project configuration

### OpenCode

OpenCode calls `opencode` from PATH. Set `CODEX_SUITE_OPENCODE_BIN` only when you
want an alternate executable.

Optionally create `.codex-suite.opencode.json` at the workspace root:

```json
{
  "model": "opencode/muse-spark-1.3-contributor-free",
  "timeoutMs": 900000,
  "instructions": "Preserve local changes and follow project conventions."
}
```

These are the only accepted keys. `timeoutMs` must be a positive integer.
Runner flags `--model` and `--timeout-ms` override the file, which overrides
built-in defaults. Pass the same explicit `--model` to preflight when overriding
model selection. Grok's `.codex-suite.md` is separate; `$codex-suite-init` does
not configure OpenCode.

### Grok

Initialize settings for the current project:

```text
$codex-suite-init
$codex-suite-init --defaults
$codex-suite-init --model deepseek-v4-flash --effort high --audit-type full --focus security-first
```

The initializer writes `.codex-suite.md` at the Git root and detects the project
stack and test command. It preserves an existing file unless you choose
Regenerate or pass `--force`. `--defaults` uses the discovered Grok default model,
high effort, mini audits, balanced focus, and per-skill sandbox defaults.

Model discovery uses `grok models`; local configuration and cache parsing are
compatibility fallbacks. An explicit user-selected slug is accepted even if
absent from discovery; the first model call validates actual availability.

You can also edit `.codex-suite.md` manually:

````markdown
## Defaults
- **Default model**: latest
- **Default effort**: high
- **Default audit type**: mini
- **Default sandbox**: workspace-write

## Audit Focus
```text
Give equal attention to all audit dimensions.
```

## Skip Patterns
```text
vendor/
dist/
```

## Project-Specific Instructions
```text
Follow existing project conventions.
```
````

Explicit choices override project settings, which override skill defaults.

## Background jobs

Add `--background` to consultation or implementation:

```text
$ask-opencode Review this branch --background
$opencode-implement Implement PLAN.md --background
$opencode-status
$opencode-result <jobId>
$opencode-cancel <jobId>
```

```text
$ask-grok Review this branch --background
$grok-implement Implement PLAN.md --background
$grok-status
$grok-result <jobId>
$grok-cancel <jobId>
```

The call returns a queued `jobId`. Controllers accept exact IDs or unique
prefixes. Status includes phase, elapsed time, model, summary, progress, and
worker session ID. Retrieve and verify an implementation result before treating
it as complete.

Jobs transition through `queued → running → completed|failed|cancelled`.
Grok also uses `stalled` for deadline failures; OpenCode records timeouts as
`failed`. Cancellation verifies the recorded PID and OS process start time
before signalling, then confirms exit. Unconfirmed termination is reported
explicitly. Cancelling a job leaves partial workspace edits for inspection.

The lifecycle hook supplies the host Codex session ID and a writable state path.
Runner calls use `--host-session-id <id> --state-data <path>`. No-reference
status/result calls, and OpenCode cancellation, use `--session-id <id>`;
controller calls must use the same `--state-data` path. Explicit job IDs search
across sessions; `status --all` lists all retained jobs for that backend.
Grok's no-reference cancellation retains its workspace-wide default.

State lives under the system temporary `codex-suite/state` directory, keyed by
canonical workspace path. Override it with `CODEX_SUITE_DATA` or `--state-data`.
The hooks avoid `PLUGIN_DATA`, which may not be writable by agent-spawned
commands. State directories use `0700`; state, log, and result files use `0600`.
Storage retains the newest 50 jobs across both backends, without pruning active
jobs.

When the host session ends, trusted hooks remove its terminal job artifacts and
terminate active workers whose identity can be proven. Workers that cannot be
safely signalled remain recorded as unconfirmed cancellations. Retrieve any
results you need before ending the host session.

## Run directly from this repository

Plugin installation is optional for direct script use.

### OpenCode

```bash
npm run preflight:opencode
node skills/ask-opencode/scripts/opencode-runner.mjs \
  --mode review --prompt-stdin <<'PROMPT'
Review the current changes for correctness bugs. Return findings with file paths.
PROMPT
```

The runner uses `run --standalone --format json` and accepts `consult`, `review`,
and `implement` modes. Add `--background` for a persistent worker, or
`--resume <threadId>` to continue the same task and mode.

```bash
node skills/ask-opencode/scripts/opencode-jobs.mjs status
node skills/ask-opencode/scripts/opencode-jobs.mjs result <jobId>
node skills/ask-opencode/scripts/opencode-jobs.mjs cancel <jobId>
```

Preflight checks OpenCode 2, required run flags, and `models --standalone`.
Model discovery does not establish authentication or inference availability.

### Grok

```bash
npm run preflight
node skills/ask-grok/scripts/grok-runner.mjs \
  --sandbox read-only --prompt-stdin <<'PROMPT'
Review the current changes for correctness bugs. Return findings with file paths.
PROMPT
```

Add `--model` or `--effort` to override configured defaults, and
`--resume <threadId>` to continue a Grok conversation.

```bash
node skills/ask-grok/scripts/grok-jobs.mjs status
node skills/ask-grok/scripts/grok-jobs.mjs result <jobId>
node skills/ask-grok/scripts/grok-jobs.mjs cancel <jobId>
```

Both runners accept `--cwd <workspace>` and read prompts through
`--prompt-stdin`. Completed calls print JSON containing `jobId`, `status`,
`threadId`, `rawOutput`, and `toolCalls`; failures include diagnostic fields.
OpenCode's `threadId` is a `ses_...` session ID. Background launch returns the
job ID and queued status instead of the final answer.

## Permission boundaries

Grok's `read-only` mode rejects ACP permission requests and client-side writes.
`workspace-write` approves operations while containing ACP file access within
the workspace. `danger-full-access` removes that containment and requires an
explicit choice. Grok can execute its own tools; global `always-approve`
settings can bypass ACP permission requests, so these controls are not an
operating-system sandbox.

OpenCode selects `explore` for consultation/review and `build` for implementation.
It uses a private standalone server and never passes `--auto`. Consultation and
review include no-mutation instructions, but
[agent overrides](https://opencode.ai/v2/docs/agents), plugins, and custom tools
still apply. This is not an operating-system sandbox. Unattended permission
requests may fail or time out; the integration reports the failure rather than
broadening permissions automatically.

## Update or uninstall

Refresh the marketplace and reinstall:

```bash
codex plugin marketplace upgrade codex-suite
codex plugin add codex-suite@codex-suite
```

Start a new Codex session, and review changed hooks with `/hooks`.

To remove the plugin and marketplace:

```bash
codex plugin remove codex-suite@codex-suite
codex plugin marketplace remove codex-suite
```

## Troubleshooting

- Missing skills: enable **Codex Suite** in `/plugins`, then start a new session.
- Stale installation: upgrade the marketplace and reinstall the plugin.
- OpenCode not found: check `opencode --version` in the environment that launches
  Codex, or set `CODEX_SUITE_OPENCODE_BIN` to the intended executable.
- OpenCode model unavailable: inspect `opencode models --standalone`, then
  explicitly select an available model. No paid replacement is automatic.
- OpenCode permission failure: review the requested operation and your OpenCode
  configuration; unattended jobs do not automatically approve prompts.
- Grok not found: install Grok Build and check `grok --version`.
- Grok authentication failure: run `grok --oauth` or expose `XAI_API_KEY` to Codex.
- Jobs missing or session cleanup inactive: review `/hooks`, start a new session,
  and ensure runner/controller calls use the same state path.
- Cancellation unconfirmed: OS process identity could not be verified or exit
  was not confirmed. Inspect the recorded job before assuming it stopped.

Inspect installations with `codex plugin marketplace list` and
`codex plugin list`. Run repository checks with `npm test`.

## Credits

The ACP lane, implementation and audit-fix workflows, and persistent job
controller are adapted from [xiaolai/cc-suite](https://github.com/xiaolai/cc-suite).
Claude-specific entry points are mapped to Codex skills, with Grok Build and
OpenCode 2 as delegated workers.
