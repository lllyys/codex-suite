import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function readSkill(name) {
  return fs.readFileSync(path.join(ROOT, "skills", name, "SKILL.md"), "utf8");
}

test("grok-implement delegates through the shared runner and requires independent verification", () => {
  const skill = readSkill("grok-implement");
  assert.match(skill, /GROK_SKILL_DIR\/scripts\/grok-preflight\.mjs/);
  assert.match(skill, /GROK_SKILL_DIR\/scripts\/grok-runner\.mjs/);
  assert.match(skill, /--sandbox <chosen_sandbox>/);
  assert.match(skill, /--model <chosen_model>/);
  assert.match(skill, /--kind implement/);
  assert.match(skill, /--background/);
  assert.match(skill, /--wait/);
  assert.match(skill, /\$grok-status/);
  assert.match(skill, /\$grok-result/);
  assert.match(skill, /\$grok-cancel/);
  assert.match(skill, /Run relevant tests, build, typecheck, and lint independently/);
  assert.match(skill, /preserve every pre-existing user change/i);
  assert.match(skill, /Implement every plan step\. Do not skip anything/);
  assert.doesNotMatch(skill, /every applicable plan step/i);
  assert.match(skill, /delegation-workflow\.md/);
  assert.doesNotMatch(skill, /\[TODO/);
});

test("grok-audit-fix persists before fixing and verifies in a fresh session", () => {
  const skill = readSkill("grok-audit-fix");
  const persist = skill.indexOf("## 3. Persist before fixing");
  const fix = skill.indexOf("## 4. Fix loop");
  assert.ok(persist >= 0 && fix > persist, "findings must be persisted before fixes");
  assert.match(skill, /Run at most three fix\/verify rounds/);
  assert.match(skill, /new `read-only` runner call with no `--resume`/);
  assert.match(skill, /\.codex-suite\/audits\/audit-fix-/);
  assert.match(skill, /FIXED\|NOT FIXED\|PARTIAL\|REGRESSED/);
  assert.match(skill, /--kind audit-fix-audit/);
  assert.match(skill, /--kind audit-fix-fix/);
  assert.match(skill, /--kind audit-fix-verify/);
  assert.match(skill, /ask the user to choose/i);
  assert.match(skill, /do not add untracked files unless explicitly requested/);
  assert.match(skill, /Analyze anyway/);
  assert.match(skill, /Grok-unavailable diagnostic block/);
  assert.match(skill, /delegation-workflow\.md/);
  assert.doesNotMatch(skill, /\[TODO/);
});

test("background control skills use the shared job controller", () => {
  for (const name of ["grok-status", "grok-result", "grok-cancel"]) {
    const skill = readSkill(name);
    assert.match(skill, /grok-jobs\.mjs/);
    assert.doesNotMatch(skill, /\[TODO/);
  }
});
