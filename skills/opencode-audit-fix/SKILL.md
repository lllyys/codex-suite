---
name: opencode-audit-fix
description: Run an OpenCode 2 audit, scoped fixes, and fresh OpenCode verification cycle when the user explicitly requests OpenCode audit and repair or invokes $opencode-audit-fix.
---

# OpenCode delegation

Locate the installed `ask-opencode` directory beside this skill and set `OPENCODE_SKILL_DIR` to its absolute path. Read [the shared workflow](../ask-opencode/references/delegation-workflow.md) for defaults, lifecycle flags, permission limits, failure handling, and result verification.

Resolve scope from the user's request; otherwise audit tracked changes, without adding untracked files. Capture the baseline and run preflight. Use the shared runner with `--mode review`, no `--resume`, and a prompt requesting severity, file and line, evidence, impact, and an actionable fix for each finding.

Persist findings in `.codex-suite/audits/opencode-audit-fix-<timestamp>.md` before fixing, with stable IDs, scope, model, job/session IDs, and per-finding status. Keep this record current across rounds.

Codex is the default fixer. If the user explicitly requests OpenCode as fixer, send confirmed findings through `--mode implement` with exact scope and validation requirements. Preserve pre-existing changes. Run at most three fix/verify rounds. Independently run relevant project checks after each fix.

Verify with a fresh `--mode review` call without `--resume`; include the original findings and current diff. Ask for `FIXED|NOT FIXED|PARTIAL|REGRESSED` per ID, supporting evidence, and newly introduced defects. Update the persisted record. Stop when all confirmed findings are verified and checks pass, or after three rounds, reporting unresolved findings. Stop on provider/CLI failure rather than silently changing model or backend.

The audit-fix cycle runs in the foreground. For a requested background audit, delegate only the review with `--background` and retrieve it before any fixes; do not imply the whole repair cycle is running autonomously.
