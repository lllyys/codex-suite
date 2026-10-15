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
| Initialize project settings | `$grok-init` | `$opencode-init` |

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

## How to use

Open your project in Codex and enter the following requests in the **Codex
conversation**, not in a shell. Codex invokes the selected skill and runs the
backend for you. OpenCode works with its free default without project
configuration; Grok requires authentication.

### 1. Ask a question or request a review

Use `$ask-opencode` for analysis, explanations, debugging advice, and second
opinions. Describe the question and relevant files:

```text
$ask-opencode Explain how authentication works in this project. Do not change files.
$ask-opencode Review my current changes for bugs and missing tests. Return findings with file and line references.
$ask-opencode Compare the two approaches in PLAN.md and recommend one, explaining the trade-offs.
```

Codex returns the worker's answer and evaluates it against project evidence.
A review identifies problems; use an implementation or audit-fix request when
you want changes made.

### 2. Delegate implementation

Use `$opencode-implement` once the task or plan is clear. You can reference a
plan file or describe the required behavior directly:

```text
$opencode-implement Implement every step in PLAN.md. Preserve existing local changes and run the relevant tests.
$opencode-implement Add pagination to the product list using the existing API. Keep the current filters working and test page navigation.
```

OpenCode edits the workspace and reports its validation. Codex then inspects
the changes and independently runs relevant checks. The workflow reports
remaining failures or incomplete steps. Commit, push, and publication require
a separate instruction.

### 3. Audit and repair changes

Use `$opencode-audit-fix` to identify issues, fix confirmed findings, and verify
the repairs:

```text
$opencode-audit-fix
$opencode-audit-fix Audit src/auth for correctness and security issues, then fix confirmed findings.
```

Without an explicit scope, the workflow audits tracked changes. It records
findings under `.codex-suite/audits/` before making fixes. OpenCode audits,
Codex fixes by default, and a fresh OpenCode session verifies each finding.
To have OpenCode make the fixes too, say so in your request. The cycle runs
up to three rounds and reports unresolved issues. The full OpenCode audit-fix
cycle runs in the foreground.

### 4. Run a longer task in the background

Add `--background` to a review or implementation request:

```text
$opencode-implement Implement PLAN.md --background
```

Codex returns a job ID. Replace `<jobId>` below with that ID:

```text
$opencode-status
$opencode-status <jobId>
$opencode-result <jobId>
$opencode-cancel <jobId>
```

Status shows progress; result retrieves the finished answer and triggers
appropriate verification for implementation work. Cancel requests termination
and reports whether exit was confirmed; it does not undo partial edits.
Retrieve results before ending the Codex session, because trusted lifecycle
hooks clean up that session's jobs. See [Background jobs](#background-jobs)
for storage and session details.

### 5. Choose Grok instead

Use the corresponding Grok skill for the same type of task:

```text
$ask-grok Review my current changes for correctness bugs.
$grok-implement Implement every step in PLAN.md.
$grok-audit-fix
$grok-audit-fix src/payments --full --severity=high --fixer=grok
$grok-implement Implement PLAN.md --background
$grok-status
$grok-result <jobId>
$grok-cancel <jobId>
```

`$grok-init` configures Grok settings (`$codex-suite-init` remains compatible);
`$opencode-init` configures OpenCode settings. See [Project configuration](#project-configuration).

You can also ask naturally: “Ask OpenCode to review these changes” or “Have
Grok implement this plan in the background.” Explicit `$skill-name` invocation
makes the backend and workflow choice clear.

## Project configuration

Both backends use **`.codex-suite.json`** at the Git root, or the current
directory outside Git. Each initializer writes only its own section and
preserves the other backend's settings.

```json
{
  "grok": {
    "model": "latest",
    "effort": "high",
    "auditType": "mini",
    "sandbox": "workspace-write",
    "focusInstructions": "Prioritize authentication and authorization defects.",
    "skipPatterns": ["vendor/", "dist/"],
    "instructions": "Follow project conventions and run relevant tests."
  },
  "opencode": {
    "model": "opencode/muse-spark-1.3-contributor-free",
    "timeoutMs": 900000,
    "instructions": "Preserve existing local changes and run relevant tests."
  }
}
```

All settings and both sections are optional. An omitted Grok `sandbox` leaves
permission selection to each skill. OpenCode defaults to the free model above
and a 15-minute timeout. Explicit invocation settings override project settings,
which override built-in defaults. This file configures delegation; native CLI
credentials and permissions remain managed by each backend.

### Initialize OpenCode

Enter in the Codex conversation:

```text
$opencode-init
$opencode-init --defaults
$opencode-init --dry-run
$opencode-init --force --timeout-ms 1200000
```

Initialization detects the stack, source directories, and test command to
produce project instructions. Override `--model`, `--timeout-ms`, or
`--instructions`; use `--instructions-file <path>` for multiline instructions.
OpenCode calls `opencode` from PATH; optionally set `CODEX_SUITE_OPENCODE_BIN`
for an alternate executable.

### Initialize Grok

```text
$grok-init
$grok-init --defaults
$grok-init --model deepseek-v4-flash --effort high --audit-type full --focus security-first
```

`$codex-suite-init` is a compatibility alias with identical behavior.
Grok supports `--model`, `--effort`, `--audit-type`, `--focus`, and `--sandbox`.
Defaults use the discovered Grok model, high effort, mini audits, balanced
focus, and per-skill sandbox selection. Model discovery uses `grok models`,
with local configuration/cache parsing as a compatibility fallback.

### Inspect, preview, or regenerate

Both initializers accept `--inspect`, `--dry-run`, `--defaults`, and `--force`.
They preserve existing backend settings by default. `--force` regenerates only
the selected backend from defaults and supplied overrides; carry forward any
custom values you want to keep. The other backend is preserved. `--dry-run`
returns the proposed complete JSON without writing; combine it with `--force`
to preview regeneration of an existing section.

A malformed unified config is reported rather than overwritten, even with
`--force`, because it may contain the other backend's settings. Repair that
file before initializing again. Concurrent initializer writes are serialized
to avoid losing either section.

### Migrate existing configuration

Legacy files remain supported:

- Grok: `.codex-suite.md`
- OpenCode: `.codex-suite.opencode.json`

Each backend first checks for its section in `.codex-suite.json`. If that
section is absent, it reads its legacy file. A present section is authoritative:
missing fields use defaults instead of inheriting legacy values. Invalid unified
JSON is an error, not a reason to silently fall back.

Copy legacy settings into the unified file with:

```text
$grok-init --migrate
$opencode-init --migrate
```

Run the command for each legacy backend you have. Migration preserves model
settings, Grok audit focus and skip patterns, and delegated instructions. It
leaves the original files untouched and preserves the other unified section.
It never overwrites an existing unified section. Do not combine `--migrate`
with overrides, `--defaults`, or `--force`; migrate first, then edit or explicitly
regenerate settings. Use `--migrate --dry-run` to preview the result.

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

Create or preview project configuration locally, without needing OpenCode or
network access:

```bash
npm run init-project:opencode -- --defaults
npm run init-project:opencode -- --dry-run
```

The writer also supports `--cwd <project>`, `--inspect`, `--model`,
`--timeout-ms`, `--instructions`, `--instructions-file`, `--migrate`, and `--force`.
It returns JSON and exits with code 2 when an existing config is preserved.

Check readiness and run a review:

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

Initialize the Grok section locally (`npm run init-project` remains an alias):

```bash
npm run init-project:grok -- --defaults
npm run init-project:grok -- --migrate --dry-run
```

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
operating-system sandbox. Direct Grok runner calls remain `read-only` unless
`--sandbox` is supplied; skills resolve the configured sandbox before invoking
the runner.

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
