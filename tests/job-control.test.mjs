import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  buildStatusSnapshot,
  cancelJob,
  resolveAnyJob,
  resolveResultJob,
} from "../skills/ask-grok/scripts/lib/job-control.mjs";
import {
  listJobs,
  resolveStateFile,
  upsertJob,
} from "../skills/ask-grok/scripts/lib/state.mjs";

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fixture() {
  const workspace = tempDir("codex-suite-jobs-");
  const stateData = tempDir("codex-suite-state-");
  const previous = process.env.CODEX_SUITE_DATA;
  process.env.CODEX_SUITE_DATA = stateData;
  return {
    workspace,
    stateData,
    cleanup() {
      if (previous === undefined) delete process.env.CODEX_SUITE_DATA;
      else process.env.CODEX_SUITE_DATA = previous;
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(stateData, { recursive: true, force: true });
    },
  };
}

test("job references accept unique prefixes and reject ambiguous prefixes", () => {
  const scope = fixture();
  try {
    upsertJob(scope.workspace, { id: "implement-alpha", status: "completed" });
    upsertJob(scope.workspace, { id: "implement-beta", status: "failed" });
    assert.equal(resolveAnyJob(scope.workspace, "implement-a").job.id, "implement-alpha");
    assert.throws(
      () => resolveAnyJob(scope.workspace, "implement-"),
      /ambiguous/,
    );
  } finally {
    scope.cleanup();
  }
});

test("no-ID status and result queries honor an explicit host session", () => {
  const scope = fixture();
  try {
    upsertJob(scope.workspace, { id: "done-a", status: "completed", sessionId: "sess-a" });
    upsertJob(scope.workspace, { id: "done-b", status: "completed", sessionId: "sess-b" });
    const snapshot = buildStatusSnapshot(scope.workspace, { sessionId: "sess-a" });
    assert.equal(snapshot.latestFinished.id, "done-a");
    assert.equal(resolveResultJob(scope.workspace, undefined, { sessionId: "sess-a" }).job.id, "done-a");
    assert.equal(resolveResultJob(scope.workspace, "done-b", { sessionId: "sess-a" }).job.id, "done-b");
  } finally {
    scope.cleanup();
  }
});

test("cancellation never signals a live PID whose identity cannot be proven", async () => {
  const scope = fixture();
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await new Promise((resolve) => setTimeout(resolve, 100));
  try {
    upsertJob(scope.workspace, {
      id: "implement-unsafe-pid",
      kind: "implement",
      status: "running",
      pid: child.pid,
      pidStartedAt: "definitely-not-this-process",
    });
    const result = cancelJob(scope.workspace, "implement-unsafe-pid");
    assert.match(result.outcome, /unverifiable|already-exited/);
    assert.doesNotThrow(() => process.kill(child.pid, 0), "the unrelated process was signalled");
    const job = listJobs(scope.workspace)[0];
    assert.equal(job.status, "cancelled");
    assert.equal(job.terminationConfirmed, result.terminated);
  } finally {
    try { process.kill(child.pid, "SIGKILL"); } catch {}
    scope.cleanup();
  }
});

test("retention keeps active jobs while bounding total stored history", () => {
  const scope = fixture();
  try {
    for (let index = 0; index < 55; index += 1) {
      upsertJob(scope.workspace, { id: `done-${index}`, status: "completed" });
    }
    upsertJob(scope.workspace, { id: "active-one", status: "running" });
    upsertJob(scope.workspace, { id: "active-two", status: "queued" });
    const jobs = listJobs(scope.workspace);
    assert.equal(jobs.length, 50);
    assert.ok(jobs.some((job) => job.id === "active-one"));
    assert.ok(jobs.some((job) => job.id === "active-two"));
    assert.equal(fs.statSync(resolveStateFile(scope.workspace)).mode & 0o777, 0o600);
  } finally {
    scope.cleanup();
  }
});
