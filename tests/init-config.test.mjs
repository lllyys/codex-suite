import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  detectProject,
  renderConfig,
  runInit,
} from "../skills/codex-suite-init/scripts/init-config.mjs";
import { loadProjectConfig } from "../skills/ask-grok/scripts/lib/config.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-suite-init-test-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    scripts: { test: "node --test" },
  }));
  return root;
}

test("init detects the project and creates parseable Grok settings", () => {
  const root = fixture();
  try {
    const detected = detectProject(root);
    assert.deepEqual(detected.stacks, ["Node.js"]);
    assert.equal(detected.testCommand, "pnpm test");
    assert.deepEqual(detected.sourceDirectories, ["src"]);

    const result = runInit({
      cwd: root,
      model: "grok-4.5",
      effort: "xhigh",
      auditType: "full",
      focus: "security-first",
      sandbox: "per-skill",
    });
    assert.equal(result.status, "created");

    const parsed = loadProjectConfig(root);
    assert.equal(parsed.defaultModel, "grok-4.5");
    assert.equal(parsed.defaultEffort, "xhigh");
    assert.equal(parsed.defaultAuditType, "full");
    assert.equal(parsed.defaultSandbox, null);
    assert.match(parsed.focusInstructions, /Prioritize security findings/);
    assert.ok(parsed.skipPatterns.includes("node_modules/"));
    assert.match(parsed.projectInstructions, /pnpm test/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("init preserves an existing config unless force is explicit", () => {
  const root = fixture();
  try {
    const configPath = path.join(root, ".codex-suite.md");
    fs.writeFileSync(configPath, "user-owned config\n");
    const result = runInit({ cwd: root });
    assert.equal(result.status, "exists");
    assert.equal(fs.readFileSync(configPath, "utf8"), "user-owned config\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("force regenerates an existing config with the selected sandbox", () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, ".codex-suite.md"), "old\n");
    const result = runInit({
      cwd: root,
      model: "latest",
      effort: "high",
      auditType: "mini",
      focus: "balanced",
      sandbox: "workspace-write",
      force: true,
    });
    assert.equal(result.status, "regenerated");
    assert.equal(loadProjectConfig(root).defaultSandbox, "workspace-write");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("renderer rejects unsupported Grok choices", () => {
  const project = {
    stacks: ["unknown"],
    sourceDirectories: [],
    testCommand: "unknown",
  };
  assert.throws(
    () => renderConfig(project, { effort: "ultra" }),
    /invalid effort: ultra/,
  );
});

test("dry-run returns content without creating the config", () => {
  const root = fixture();
  try {
    const result = runInit({ cwd: root, dryRun: true });
    assert.equal(result.status, "dry-run");
    assert.equal(result.exists, false);
    assert.equal(result.wouldWrite, true);
    assert.match(result.content, /# Codex Suite Configuration/);
    assert.equal(fs.existsSync(path.join(root, ".codex-suite.md")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
