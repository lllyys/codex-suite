---
name: grok-audit-fix
description: Run a durable audit, fix, and independent verification cycle using Grok Build as the auditor, Codex or Grok as the fixer, and a fresh Grok session as verifier. Use when the user explicitly asks Grok to audit and fix code, requests an audit-fix loop, or explicitly invokes $grok-audit-fix.
---

# Grok Audit Fix

Run `audit → persist findings → fix → fresh verification`. Keep the findings file as the source of truth throughout the loop.

Set `SKILL_DIR` to this skill's absolute directory and `GROK_SKILL_DIR` to `$SKILL_DIR/../ask-grok`. Read `$GROK_SKILL_DIR/references/delegation-workflow.md` before selecting settings or calling the runner.

## Arguments and defaults

Interpret invocation text as a scope plus optional flags:

- `--mini`: 5 dimensions.
- `--full`: 9 dimensions.
- `--severity=all|high`: findings to fix; default `all`. `high` means Critical and High for full audits and High for mini audits.
- `--fixer=codex|grok`: who edits; default `codex`.
- `--ask`: ask about fix scope, fixer, and additional rounds. Without it, fix all selected findings once and stop if verification leaves anything unresolved.

When neither audit-depth flag is present, use the configured default if valid; otherwise ask the user to choose Mini (recommended) or Full. Use `read-only` for audit and verification. The built-in settings recommendation is the first available model, `high` effort, and `workspace-write` for Grok fixing. Apply explicit-user → project-config → built-in priority and confirm separately before any `danger-full-access` call, even without `--ask`.

## 1. Preflight and scope

```bash
node "$GROK_SKILL_DIR/scripts/grok-preflight.mjs"
node "$GROK_SKILL_DIR/scripts/grok-config.mjs" "<absolute workspace>"
```

Present the chosen model, effort, and fix sandbox before the first call; audit and verification remain read-only regardless of the selected fix sandbox.

Resolve scope:

- Empty: tracked uncommitted files from `git diff HEAD --name-only`; do not add untracked files unless explicitly requested.
- `staged`: `git diff --cached --name-only`.
- `commit -N`: files changed since `HEAD~N`.
- File or directory: that explicit path.
- `--full` by itself changes depth, not scope; when no changed-file scope exists, use conventional code roots (`src`, `lib`, `app`) that actually exist.

Stop when the resolved scope is empty. Preserve pre-existing changes. Filter the file list against configured skip patterns, then skip generated, vendored, binary, and dependency directories. If every file is excluded, report that and stop. For mini audits, skip tests unless explicitly requested; full audits include them. Do not exclude non-code files when the user explicitly names them.

If every change is mechanical, five lines or fewer, and contains no logic, security, dependency, runtime configuration, validation, or error-handling change, ask whether to `Skip (Recommended)` or `Analyze anyway`. Skip only after the user chooses Skip.

## 2. Audit with Grok

Audit each code file in its own fresh `read-only` Grok call with `--kind audit-fix-audit`, a file-specific summary, `--model <chosen_model>`, `--effort <chosen_effort>`, and `--timeout-ms 600000`. For more than 20 files, process sequential groups of 10 and report progress. Never use `--resume` across different files. Add `--host-session-id <id> --state-data <path>` when SessionStart supplied them.

For mini audits, check:

1. Logic and correctness.
2. Duplication.
3. Dead code.
4. Refactoring debt.
5. Shortcuts and incomplete error handling.

For full audits, check:

1. Redundant and low-value code.
2. Security and risk.
3. Correctness and reliability.
4. Compliance and standards.
5. Maintainability and readability.
6. Performance and efficiency.
7. Testing and validation.
8. Dependency and environment safety.
9. Documentation and knowledge transfer.

Use this output contract in every audit prompt:

```json
{
  "findings": [
    {
      "file": "relative/path",
      "line": 1,
      "severity": "High|Medium|Low for mini; Critical|High|Medium|Low for full",
      "dimension": "dimension name",
      "finding": "what is wrong",
      "suggestedFix": "smallest correct fix"
    }
  ]
}
```

Require JSON only, exact `file:line` evidence, no edits, no speculative findings, and an empty array when clean. Pass the absolute workspace via `--cwd`. Treat malformed or unsupported claims as non-findings unless Codex can verify the cited code.

If any Grok call is empty, incomplete, failed, or stalled, emit the shared Grok-unavailable diagnostic block. Codex must audit that file manually against the same dimensions and mark those rows `Auditor: Codex fallback`. Persist and report the complete degraded audit, but do not start the fix loop.

If all files are clean, report `CLEAN` and do not create a findings file.

## 3. Persist before fixing

Before editing any code, create `.codex-suite/audits/audit-fix-YYYYMMDD-HHMMSS-findings.md` with `apply_patch`. Escape table pipes and keep one row per finding:

```markdown
# Audit Findings

**Run**: audit-fix YYYYMMDD-HHMMSS
**Scope**: <scope>
**Audit type**: mini|full
**Model**: <model or default>
**Audit threads**: <file=threadId entries>
**Status values**: open | fixed | not-fixed | partial | regressed | skipped (severity filter) | skipped (user stop)

| # | File | Line | Severity | Dimension | Finding | Suggested fix | Auditor | Status | Round | Notes |
|---|------|------|----------|-----------|---------|---------------|---------|--------|-------|-------|
| 1 | path | 1 | High | Logic | description | fix | Grok | open | - | - |
```

If persistence fails, display the full table and stop before fixing. Never run the loop from a reconstructed or memory-only finding list.

## 4. Fix loop

Run at most three fix/verify rounds. Re-read the findings file at the start of every round. The fix set is every severity-selected row with status `open`, `not-fixed`, or `partial`.

Mark excluded rows `skipped (severity filter)`. If `--ask` is set, let the user stop or change fixer before editing; mark stopped rows `skipped (user stop)`.

### Codex fixer

For each selected row:

1. Read the current cited context.
2. Apply the smallest targeted fix with `apply_patch`.
3. Avoid unrelated refactors and preserve user changes.
4. Add or update a behavioral test only when the finding requires it or the smallest correct regression proof needs it.
5. Run the relevant focused tests, then broader project verification when practical.

### Grok fixer

Use a fresh call, never an audit-session resume:

```bash
node "$GROK_SKILL_DIR/scripts/grok-runner.mjs" \
  --kind audit-fix-fix \
  --summary "audit-fix round <N>: fix <count> findings" \
  --model <chosen_model> \
  --sandbox <chosen_fix_sandbox> \
  --effort <chosen_effort> \
  --timeout-ms 900000 \
  --prompt-stdin <<'CODEX_SUITE_FIX_PROMPT'
Fix only the supplied findings at their cited locations. Make the smallest correct changes, preserve unrelated work, add behavioral tests where needed, run relevant project tests, and report fixed and unresolved finding IDs.

Findings:
<rows re-read from the findings file>
CODEX_SUITE_FIX_PROMPT
```

Add `--host-session-id <id> --state-data <path>` when SessionStart supplied them. Codex must inspect the resulting diff and tests before verification.

If a Grok fixer call is empty, incomplete, failed, or stalled, report its job ID and diagnostics, then fall back to the Codex fixer for the same rows and disclose the fallback before verification.

## 5. Verify in a fresh Grok session

Verification must use a new `read-only` runner call with no `--resume`, regardless of fixer. Supply only the round's original rows and require JSON:

Label it with `--kind audit-fix-verify`, use `--model <chosen_model> --effort <chosen_effort>`, and set `--timeout-ms 600000`. Add the same lifecycle values when supplied.

```json
{
  "verdicts": [
    { "id": 1, "verdict": "FIXED|NOT FIXED|PARTIAL|REGRESSED", "notes": "evidence" }
  ]
}
```

Tell Grok to re-read each cited location and judge the underlying defect, not the fixer's report. Reject missing finding IDs or unsupported verdicts. Update each row's lowercase Status, Round, and Notes in the findings file immediately after parsing the result.

If Grok verification is empty, incomplete, failed, or stalled, emit the shared diagnostic block. Codex must manually re-read and verify every row against the same verdict contract, recording `Codex fallback verification` in Notes. Never mark anything fixed from the fixer's self-report alone.

## 6. Continue or stop

- All selected rows fixed: stop with `ACCEPTED`.
- Unresolved rows and `--ask`, with fewer than three rounds: ask whether to retry, switch fixer, or stop.
- Unresolved rows without `--ask`: stop after the first round with `PARTIAL` or `UNCHANGED`.
- Third round completed: stop and report remaining rows.

Render the final counts and tables from the findings file, not conversation memory. Include scope, audit depth, fixer, model, thread IDs, round count, findings path, `git diff --stat`, verification commands, fixed findings, and remaining findings.

Do not commit, push, publish, or destructively revert changes unless separately requested.
