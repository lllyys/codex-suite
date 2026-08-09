import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createJobLogFile,
  listJobs,
  resolveJobFile,
  upsertJob,
  writeJobFile,
} from "../skills/ask-grok/scripts/lib/state.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HOOK = path.join(ROOT, "scripts/session-lifecycle-hook.mjs");

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "codex-suite-hook-"));
  const stateData = fs.mkdtempSync(path.join(os.tmpdir(), "codex-suite-state-"));
  const previous = process.env.CODEX_SUITE_DATA;
  process.env.CODEX_SUITE_DATA = stateData;
  return {
    workspace,
    stateData,
    run(event, sessionId) {
      const env = { ...process.env, PLUGIN_DATA: stateData };
      delete env.CODEX_SUITE_DATA;
      return spawnSync(process.execPath, [HOOK, event], {
        cwd: workspace,
        encoding: "utf8",
        input: JSON.stringify({
          hook_event_name: event,
          session_id: sessionId,
          cwd: workspace,
          ...(event === "SessionStart" ? { source: "startup" } : { reason: "other" }),
        }),
        env,
      });
    },
    cleanup() {
      if (previous === undefined) delete process.env.CODEX_SUITE_DATA;
      else process.env.CODEX_SUITE_DATA = previous;
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(stateData, { recursive: true, force: true });
    },
  };
}

test("SessionStart injects the host session id runner instruction", () => {
  const scope = fixture();
  try {
    const result = scope.run("SessionStart", "thr-fixture");
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(output.hookSpecificOutput.additionalContext, /--host-session-id thr-fixture/);
    assert.match(output.hookSpecificOutput.additionalContext, /--session-id thr-fixture/);
    assert.match(output.hookSpecificOutput.additionalContext, /--state-data/);
  } finally {
    scope.cleanup();
  }
});

test("SessionEnd removes finished jobs only for the ending session", () => {
  const scope = fixture();
  try {
    const logFile = createJobLogFile(scope.workspace, "done-a");
    upsertJob(scope.workspace, {
      id: "done-a", status: "completed", sessionId: "sess-a", logFile,
    });
    writeJobFile(scope.workspace, "done-a", { rawOutput: "finished" });
    upsertJob(scope.workspace, {
      id: "done-b", status: "completed", sessionId: "sess-b",
    });
    const result = scope.run("SessionEnd", "sess-a");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(listJobs(scope.workspace).map((job) => job.id), ["done-b"]);
    assert.equal(fs.existsSync(resolveJobFile(scope.workspace, "done-a")), false);
    assert.equal(fs.existsSync(logFile), false);
  } finally {
    scope.cleanup();
  }
});

test("SessionEnd retains an unsignallable queued job as cancelled", () => {
  const scope = fixture();
  try {
    upsertJob(scope.workspace, {
      id: "queued-a", status: "queued", phase: "queued", sessionId: "sess-a",
    });
    const result = scope.run("SessionEnd", "sess-a");
    assert.equal(result.status, 0, result.stderr);
    const job = listJobs(scope.workspace)[0];
    assert.equal(job.status, "cancelled");
    assert.equal(job.phase, "cancelled");
    assert.equal(job.terminationConfirmed, false);
    assert.match(job.errorMessage, /no recorded PID/);
  } finally {
    scope.cleanup();
  }
});

test("plugin bundles trusted-review lifecycle definitions", () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, "hooks/hooks.json"), "utf8"));
  assert.ok(hooks.hooks.SessionStart);
  assert.ok(hooks.hooks.SessionEnd);
  assert.equal(hooks.hooks.SessionEnd[0].hooks[0].timeout, 3);
  assert.match(hooks.hooks.SessionStart[0].hooks[0].command, /\$\{PLUGIN_ROOT\}/);
});
