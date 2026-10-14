# codex-suite

A small Codex plugin that delegates work to Grok Build over the
[Agent Client Protocol](https://agentclientprotocol.com/) and to
[OpenCode 2 CLI](https://opencode.ai/v2/docs/cli).

## What it includes

- `$ask-grok`, a general delegation skill for reviews and second opinions
- `$codex-suite-init`, current-project Grok model, effort, audit, and instruction setup
- `$grok-implement`, a plan → implementation → independent Codex verification workflow
- `$grok-audit-fix`, a durable audit → fix → fresh Grok verification loop
- `$grok-status`, `$grok-result`, and `$grok-cancel` for persistent background jobs
- plugin-bundled `SessionStart` / `SessionEnd` hooks for session-scoped jobs and safe cleanup
- `.codex-suite.md` defaults, audit focus, skip patterns, and project-instruction injection
- a preflight that checks the Grok binary and authentication, then uses the official `grok models` discovery command without sending a model request
- a dependency-free Node.js ACP client using `initialize → session/new|load → session/prompt`
- streamed answer collection, session resume, bounded timeouts, and structured JSON output
- `read-only`, `workspace-write`, and `danger-full-access` permission profiles
- workspace path containment for ACP file operations outside danger-full-access mode

- Six OpenCode skills: `$ask-opencode`, `$opencode-implement`, `$opencode-audit-fix`,
  `$opencode-status`, `$opencode-result`, and `$opencode-cancel`
- OpenCode CLI JSON streaming with a free default model and independent job controls

## Requirements

- Node.js 18.18 or newer
- For the Grok lane: [Grok Build](https://x.ai/cli) installed and authenticated, or `XAI_API_KEY` set
- For the OpenCode lane: OpenCode 2 on PATH; credentials depend on the selected provider
- Codex CLI or Codex in the ChatGPT desktop app; plugins are not available in the IDE extension

See the [official Codex plugin documentation](https://learn.chatgpt.com/docs/plugins)
for supported surfaces and the plugin browser.

## Install

### 1. Prepare Grok Build

Install Grok Build from the [xAI CLI page](https://x.ai/cli). Confirm Node.js and
Grok Build are available, then start the OAuth sign-in flow:

```bash
node --version
grok --version
grok --oauth
```

Node.js must be 18.18 or newer. Instead of OAuth, you can export an
`XAI_API_KEY` in the environment that launches Codex.

### 2. Add the marketplace and install the plugin

Run these commands once:

```bash
codex plugin marketplace add lllyys/codex-suite --ref main
codex plugin add codex-suite@codex-suite
```

The first command registers this GitHub repository as the `codex-suite`
marketplace. The second installs the `codex-suite` plugin from it.

### 3. Enable it and trust the hooks

Start Codex, then open the plugin browser:

```text
codex
/plugins
```

Find **Codex Suite**, confirm it is installed and enabled, and press Space if
it is disabled. Next, run `/hooks`, review the bundled `SessionStart` and
`SessionEnd` commands, and trust them. The skills work without the hooks, but
session-scoped background-job cleanup does not.

Start a **new Codex session** after installing, enabling, updating, or trusting
the plugin. Bundled skills and hooks are discovered at session startup.

### 4. Verify the installation

In the new session, enter:

```text
$ask-grok Reply with exactly: grok connection ok
```

The skill first checks the local Grok installation and authentication, then
uses Grok Build's official `grok models` command before sending the request. A
successful response confirms the complete Codex → Grok path.

## Quick start

Initialize Grok settings for the current project. Interactive mode asks only
for unresolved choices; `--defaults` selects the detected Grok default model,
high effort, mini audits, balanced focus, and per-skill sandbox defaults:

```text
$codex-suite-init
$codex-suite-init --defaults
```

Pin concrete settings without changing Codex's own model configuration:

```text
$codex-suite-init --model deepseek-v4-flash --effort high --audit-type full --focus security-first
```

The initializer writes `.codex-suite.md` at the Git root, detects the project
stack and test command, and never replaces an existing file unless you choose
Regenerate or pass `--force`. Model discovery normally comes from the official
`grok models` command. Direct `~/.grok/config.toml` plus local-cache parsing is
only a compatibility fallback. An explicit model slug is accepted even when it
has not appeared in discovery; the first Grok call remains the final validation.

Ask Grok for a second opinion without changing files:

```text
$ask-grok Review the current changes for correctness bugs.
```

Have Grok implement an agreed plan, followed by independent Codex verification:

```text
$grok-implement Implement every step in PLAN.md.
```

Run the audit → fix → fresh Grok verification workflow on the current tracked
changes, or on an explicit path:

```text
$grok-audit-fix
$grok-audit-fix src/payments --full --severity=high --fixer=grok
```

Run a request in the background and inspect it later:

```text
$ask-grok Review the current branch --background
$grok-status
$grok-result <jobId>
$grok-cancel <jobId>
```

You can also describe the intent naturally, for example: “Use Grok to audit
these changes and fix confirmed high-severity issues.” Explicit `$skill-name`
invocation is the most predictable form.

## OpenCode 2 quick start

Install OpenCode following its [official CLI documentation](https://opencode.ai/v2/docs/cli),
then check `opencode --version`. The integration was checked with v2.0.28.
It calls `opencode` from PATH; optionally set `CODEX_SUITE_OPENCODE_BIN` to an
alternate executable. It does not require Grok installation or credentials.

```text
$ask-opencode Review the current changes for correctness bugs.
$opencode-implement Implement every step in PLAN.md.
$opencode-audit-fix
$ask-opencode Review this branch --background
$opencode-status
$opencode-result <jobId>
$opencode-cancel <jobId>
```

The six skills use `opencode/muse-spark-1.3-contributor-free` by default.
Free model availability and quotas can change; no paid fallback is selected
silently. The optional workspace-root `.codex-suite.opencode.json` accepts:

```json
{
  "model": "opencode/muse-spark-1.3-contributor-free",
  "timeoutMs": 900000,
  "instructions": "Preserve local changes and follow project conventions."
}
```

CLI `--model` and `--timeout-ms` override this file. Grok's `.codex-suite.md`
and `$codex-suite-init` remain Grok-specific and are preserved.

```bash
npm run preflight:opencode
node skills/ask-opencode/scripts/opencode-runner.mjs --mode consult --prompt-stdin <<'PROMPT'
Review the current changes for correctness bugs. Return findings with file paths.
PROMPT
```

Preflight checks OpenCode 2, required flags, and `models --standalone`, without
sending a model prompt. Model listing does not establish successful authentication
or inference. A missing default model is reported instead of selecting a substitute.

The runner uses `run --standalone --format json`, avoiding OpenCode's shared
background service. Modes are `consult`, `review`, and `implement`; consultation
and review select `explore`, implementation selects `build`. It never passes
`--auto`. Consult/review requests instruct the worker not to mutate files;
[agent configuration](https://opencode.ai/v2/docs/agents), custom tools, and
local overrides still apply, so this is not an operating-system sandbox.
Permission requests during unattended implementation can fail or time out.

Output contains `jobId`, `status`, `threadId` (an OpenCode `ses_...` session ID),
`rawOutput`, `toolCalls`, and `error`. Continue a task with `--resume <threadId>`;
audit verification starts a fresh session. Codex independently inspects and tests
implementation results. Audit-fix persists findings before fixes, defaults to
Codex as fixer, and stops after at most three rounds; the full cycle is foreground.

Add `--background` to the runner for a persistent job. The OpenCode jobs controller
supports `status|result|cancel`, exact IDs and unique prefixes. No-reference queries
are session-scoped when `--session-id` is supplied; `status --all` crosses sessions.
Pass `--host-session-id` and `--state-data` supplied by SessionStart to the runner,
and the same state path to controller commands. Grok and OpenCode controllers
filter their own jobs while sharing private storage and session cleanup.
Cancellation verifies process identity and reports whether exit was confirmed;
partial workspace edits remain for inspection.

## Update or uninstall

Refresh the GitHub marketplace snapshot and reinstall the current plugin:

```bash
codex plugin marketplace upgrade codex-suite
codex plugin add codex-suite@codex-suite
```

Then start a new Codex session. If the hook definition changed, review it again
with `/hooks`.

To remove both the plugin and its marketplace source:

```bash
codex plugin remove codex-suite@codex-suite
codex plugin marketplace remove codex-suite
```

## Troubleshooting installation

- `$ask-grok` is missing: open `/plugins`, enable **Codex Suite**, then start a
  new session.
- The marketplace is stale: run `codex plugin marketplace upgrade codex-suite`
  and reinstall the plugin.
- Preflight reports that Grok is missing: install Grok Build and confirm
  `grok --version` works in the same environment that launches Codex.
- Preflight reports an authentication error: run `grok --oauth` again, or expose
  `XAI_API_KEY` to Codex.
- Background jobs are not scoped to the current session: run `/hooks` and trust
  the plugin's lifecycle hooks, then start a new session.
- Inspect configured sources and installed plugins with
  `codex plugin marketplace list` and `codex plugin list`.

## Use the runner without installing the plugin

The preflight is local and does not make a model request:

```bash
npm run preflight
```

Run a read-only delegation:

```bash
node skills/ask-grok/scripts/grok-runner.mjs \
  --sandbox read-only \
  --prompt-stdin <<'PROMPT'
Review the current changes for correctness bugs. Return findings with file paths.
PROMPT
```

The runner prints one JSON object:

```json
{
  "jobId": "grok-...",
  "status": "completed",
  "threadId": "session-id",
  "rawOutput": "Grok's answer",
  "toolCalls": 2
}
```

Continue the same Grok conversation with `--resume <threadId>`. Add `--model`
or `--effort` to override Grok's configured defaults.

## Skill details

Ask Grok for a focused opinion:

```text
$ask-grok Review the current changes for correctness bugs.
```

Delegate an agreed plan and have Codex verify the result:

```text
$grok-implement Implement PLAN.md.
```

Run the audit/fix workflow. If no audit depth is configured, the skill asks you
to choose Mini (recommended) or Full; Codex is the default fixer:

```text
$grok-audit-fix
$grok-audit-fix src/payments --full --severity=high --fixer=grok
```

Audit findings are persisted under `.codex-suite/audits/` before any fix. The
file remains the source of truth for per-finding status across up to three
fix/verify rounds.

Run `$codex-suite-init` to generate the optional `.codex-suite.md`. You can also
create or edit it manually using this layout:

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

Explicit user choices override project configuration, which overrides each
skill's built-in recommendation.

## Background jobs

Add `--background` to a direct delegation or implementation:

```text
$ask-grok Review the current branch --background
$grok-implement Implement PLAN.md --background
```

The call returns a `jobId` immediately. Manage it with:

```text
$grok-status
$grok-status <jobId>
$grok-result <jobId>
$grok-cancel <jobId>
```

Jobs transition through `queued → running → completed|failed|stalled|cancelled`.
The controller stores model settings, phase, deadline, PID and OS process start
time, progress logs, Grok thread ID, and the final result. Cancellation verifies
process identity before signalling the process group, then escalates from
`SIGTERM` to `SIGKILL` only if necessary.

Inside an enabled plugin session, the lifecycle hook routes state to the private,
sandbox-writable system-temporary root `codex-suite/state`. It deliberately does
not use Codex's `PLUGIN_DATA` directory because agent-spawned commands may not
have write access to that directory. Set `CODEX_SUITE_DATA` or pass
`--state-data` to choose another persistent private root that is writable under
the current Codex permission profile. State is keyed by the canonical workspace
path. Directories are hardened to `0700`; state, logs, and result files use
`0600`. The newest 50 jobs are retained, while active jobs are never pruned.

The bundled lifecycle hook supplies the current Codex session ID to the skills.
When the main thread ends, it removes terminal jobs for that session and safely
terminates active workers whose process identity can be proven. Jobs that cannot
be safely signalled remain recorded as unconfirmed cancellations. After install
or hook changes, review and trust the plugin hook with `/hooks`; Codex skips
untrusted command hooks by design.

## Security model

`read-only` rejects ACP permission requests and client-side writes.
`workspace-write` approves operations but keeps ACP file access inside the
workspace. `danger-full-access` removes that containment and must be selected
explicitly.

Grok can also execute its own tools. If `~/.grok/config.toml` globally sets
`permission_mode = "always-approve"`, those tools may be approved before the
ACP client sees a permission request. Consequently, `read-only` is best-effort,
not an operating-system sandbox.

## Credits

The ACP lane, the `implement` and `audit-fix` workflows, and the persistent job
controller are adapted from
[xiaolai/cc-suite](https://github.com/xiaolai/cc-suite). Claude-specific entry
points are mapped to Codex skills, with Grok Build and OpenCode 2 as delegated workers.
