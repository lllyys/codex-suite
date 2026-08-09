import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDelegatedPrompt,
  loadProjectConfig,
} from "../skills/ask-grok/scripts/lib/config.mjs";

const CONFIG = `# Codex Suite

## Defaults

- **Default model**: latest
- **Default effort**: xhigh
- **Default audit type**: full
- **Default sandbox**: workspace-write

## Audit Focus

security-first

\`\`\`text
Prioritize authentication and authorization defects.
\`\`\`

## Skip Patterns

\`\`\`text
vendor/
*.min.js
\`\`\`

## Project-Specific Instructions

\`\`\`text
Preserve the public API and use the existing test framework.
\`\`\`
`;

test("project configuration is parsed and injected by command kind", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-suite-config-"));
  try {
    fs.writeFileSync(path.join(workspace, ".codex-suite.md"), CONFIG);
    const config = loadProjectConfig(workspace);
    assert.equal(config.defaultModel, "latest");
    assert.equal(config.defaultEffort, "xhigh");
    assert.equal(config.defaultAuditType, "full");
    assert.equal(config.defaultSandbox, "workspace-write");
    assert.deepEqual(config.skipPatterns, ["vendor/", "*.min.js"]);
    assert.match(config.focusInstructions, /authentication/);
    assert.match(config.projectInstructions, /public API/);

    const audit = buildDelegatedPrompt(workspace, "audit-fix-audit", "Audit src/a.js", "BOUNDARY");
    assert.match(audit, /competing AI system/);
    assert.match(audit, /Prioritize authentication/);
    assert.match(audit, /Preserve the public API/);
    assert.match(audit, /audit skip patterns:[\s\S]*vendor\//);
    assert.match(audit, /BOUNDARY[\s\S]*Audit src\/a\.js/);

    const implement = buildDelegatedPrompt(workspace, "implement", "Build it", "BOUNDARY");
    assert.doesNotMatch(implement, /Prioritize authentication/);
    assert.match(implement, /Leave these paths untouched[\s\S]*\*\.min\.js/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
