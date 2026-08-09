# Shared Grok delegation workflow

Use this reference for `$ask-grok`, `$grok-implement`, and `$grok-audit-fix`.

## Configuration and selection

Run the readiness and project-configuration commands before the first Grok call:

```bash
node "$SKILL_DIR/scripts/grok-preflight.mjs"
node "$SKILL_DIR/scripts/grok-config.mjs" "<absolute workspace>"
```

For sibling skills, set `SKILL_DIR` to `../ask-grok` first. The config command reads optional `.codex-suite.md` values:

- `Default model`, where `latest` means preflight's current default and a concrete slug is a pin.
- `Default effort`, `Default audit type`, and `Default sandbox`.
- fenced `Audit Focus`, `Skip Patterns`, and `Project-Specific Instructions` sections.

Apply selection priority exactly: explicit user choice, then project config, then the calling skill's built-in recommendation. Preflight uses the official `grok models` command and reports `config-cache-fallback` when it must fall back to direct local discovery:

- Never invent a model slug. Accept a concrete slug explicitly supplied by the user even if it is absent from preflight, label it unconfirmed by model discovery, and let the first Grok invocation validate it.
- Respect a concrete project model pin even if it is absent from preflight, but disclose that it is locally unconfirmed. Do not rewrite or reject the pin solely because the local cache lacks it.
- If no explicit choice or project pin exists and one model is discovered, select it and tell the user. Otherwise present at most four discovered models, recommended first.
- Resolve `latest` to preflight's current `default_model`.
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
- Locally discovered models: <available list or unavailable>
- Suggested fix: install Grok Build, run `grok --oauth`, set `XAI_API_KEY`, or run preflight again as indicated by `error_code`.
```

Never retry the same failed call automatically. Preserve and label partial output. Follow the calling skill's fallback policy.
