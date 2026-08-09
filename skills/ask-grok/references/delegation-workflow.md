# Shared Grok delegation workflow

Use this reference for `$ask-grok`, `$grok-implement`, and `$grok-audit-fix`.

## Configuration and selection

Run both local discovery commands before the first Grok call:

```bash
node "$SKILL_DIR/scripts/grok-preflight.mjs"
node "$SKILL_DIR/scripts/grok-config.mjs" "<absolute workspace>"
```

For sibling skills, set `SKILL_DIR` to `../ask-grok` first. The config command reads optional `.codex-suite.md` values:

- `Default model`, where `latest` means preflight's current default and a concrete slug is a pin.
- `Default effort`, `Default audit type`, and `Default sandbox`.
- fenced `Audit Focus`, `Skip Patterns`, and `Project-Specific Instructions` sections.

Apply selection priority exactly: explicit user choice, then valid project config, then the calling skill's built-in recommendation. Validate every choice against preflight:

- If one model exists, select it and tell the user. Otherwise present at most four available models, recommended first.
- If a concrete configured model is unavailable, recommend preflight's default, disclose the stale pin, and offer to rewrite only its config line to `latest`, the selected model, or leave it unchanged.
- Offer only supported effort levels; if a configured or recommended effort is unavailable, use the highest available level and disclose the fallback.
- Validate sandbox against preflight. Confirm separately before `danger-full-access`.

Before sending, show model, effort, sandbox, absolute workspace, and a brief task/scope summary.

## Prompt and skip rules

The runner automatically prepends the command persona, Codex provenance disclosure, anti-recursion boundary, Audit Focus for audit/verify kinds, Project-Specific Instructions for every kind, and Skip Patterns. Do not duplicate that preamble in the command body.

For audits, filter the resolved file list against configured skip patterns before calling Grok. For implementation, the runner turns the patterns into leave-untouched instructions because the task has no bounded file list.

If the SessionStart hook supplied a Codex Suite session id, pass it as `--host-session-id <id>` on every runner call. When it also supplied plugin state storage, pass `--state-data <path>` on runner and job-control calls. Pass `--session-id <id>` to no-argument status/result queries. This associates foreground and background jobs with the host session and its private plugin data so queries and SessionEnd cleanup are scoped correctly.

## Failure diagnostics

When a runner call is empty, incomplete, failed, or stalled, rerun `grok-preflight.mjs` locally and include this mapped diagnostic block before the calling skill's fallback:

```markdown
**Grok unavailable — Codex fallback.**
- Job: <jobId>
- Runner status/error: <status and error>
- Grok binary: <version or unavailable>
- Authentication: <auth_mode or preflight error>
- Models: <available list or unavailable>
- Suggested fix: install Grok Build, run `grok --oauth`, set `XAI_API_KEY`, or run preflight again as indicated by `error_code`.
```

Never retry the same failed call automatically. Preserve and label partial output. Follow the calling skill's fallback policy.
