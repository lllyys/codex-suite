import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUNNER = path.join(ROOT, "skills/ask-grok/scripts/grok-runner.mjs");
const PREFLIGHT = path.join(ROOT, "skills/ask-grok/scripts/grok-preflight.mjs");
const JOBS = path.join(ROOT, "skills/ask-grok/scripts/grok-jobs.mjs");

const FAKE_GROK = `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("grok test-1.0\\n");
  process.exit(0);
}
if (process.argv.includes("models")) {
  if (process.env.FAKE_MODELS_FAIL) {
    process.stderr.write("model discovery unavailable\\n");
    process.exit(1);
  }
  process.stdout.write(process.env.FAKE_MODELS || "Default model: grok-test\\n\\nAvailable models:\\n  * grok-test (default)\\n");
  process.exit(0);
}

let buffer = "";
let requestId = 1000;
let authenticated = false;
const pending = new Map();
function send(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
function request(method, params) {
  return new Promise((resolve) => {
    const id = requestId++;
    pending.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });
}
function reply(message, result) { send({ jsonrpc: "2.0", id: message.id, result }); }

async function handle(message) {
  if (message.id !== undefined && pending.has(message.id) && (message.result !== undefined || message.error !== undefined)) {
    const resolve = pending.get(message.id);
    pending.delete(message.id);
    resolve(message);
    return;
  }
  if (message.method === "initialize") {
    reply(message, {
      protocolVersion: 1,
      authMethods: [{ id: "cached_token" }, { id: "xai.api_key" }],
      agentCapabilities: {},
    });
  } else if (message.method === "authenticate") {
    if (process.env.FAKE_AUTH_REQUIRED && message.params?._meta?.headless !== true) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: 403, message: "Headless authentication required." } });
      return;
    }
    authenticated = true;
    reply(message, {});
  } else if (message.method === "session/load") {
    if (process.env.FAKE_LOAD_FAIL) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "load unsupported" } });
    } else {
      reply(message, {});
    }
  } else if (message.method === "session/new") {
    if (process.env.FAKE_AUTH_REQUIRED && !authenticated) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: 403, message: "Permission denied." } });
    } else {
      reply(message, { sessionId: "new-session" });
    }
  } else if (message.method === "session/prompt") {
    if (process.env.FAKE_HANG) return;
    let answer = process.env.FAKE_ANSWER || "THE ANSWER";
    const prompt = message.params?.prompt?.[0]?.text || "";
    if (process.env.FAKE_ECHO_PROMPT) answer = prompt;
    if (process.env.FAKE_ECHO_ARGS) answer = JSON.stringify(process.argv.slice(2));
    if (process.env.FAKE_PERMISSION) {
      const permission = await request("session/request_permission", {
        options: [{ optionId: "allow_once" }, { optionId: "reject_once" }],
      });
      answer = JSON.stringify(permission.result);
    }
    if (process.env.FAKE_OUTSIDE_READ) {
      const read = await request("fs/read_text_file", { path: process.env.FAKE_OUTSIDE_READ });
      answer = read.error?.message || "unexpected success";
    }
    if (!process.env.FAKE_NO_ANSWER) {
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: message.params.sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { text: answer } },
        },
      });
    }
    reply(message, { stopReason: process.env.FAKE_STOP || "end_turn" });
  } else if (message.method === "session/cancel") {
    process.exit(0);
  }
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let newline;
  while ((newline = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    handle(JSON.parse(line)).catch((error) => {
      process.stderr.write(error.stack + "\\n");
      process.exit(1);
    });
  }
});
`;

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeFakeBin(workspace) {
  const bin = path.join(workspace, "bin");
  fs.mkdirSync(bin);
  const executable = path.join(bin, "grok");
  fs.writeFileSync(executable, FAKE_GROK, { mode: 0o755 });
  return bin;
}

function parseLastJson(stdout) {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return line ? JSON.parse(line) : null;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runJobs(command, workspace, stateData, reference = null) {
  const args = [JOBS, command];
  if (reference) args.push(reference);
  args.push("--cwd", workspace);
  return spawnSync(process.execPath, args, {
    cwd: workspace,
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, CODEX_SUITE_DATA: stateData },
  });
}

function waitForJob(workspace, stateData, jobId, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    const result = runJobs("status", workspace, stateData, jobId);
    if (result.status === 0) {
      latest = parseLastJson(result.stdout)?.job || null;
      if (latest && predicate(latest)) return latest;
    }
    sleep(50);
  }
  throw new Error(`timed out waiting for ${jobId}; latest=${JSON.stringify(latest)}`);
}

function runRunner(options = {}) {
  const workspace = tempDir("codex-suite-runner-");
  const stateData = tempDir("codex-suite-state-");
  const bin = makeFakeBin(workspace);
  if (options.config) fs.writeFileSync(path.join(workspace, ".codex-suite.md"), options.config);
  const args = [
    RUNNER,
    "--cwd", workspace,
    "--sandbox", options.sandbox || "read-only",
    "--timeout-ms", String(options.timeoutMs || 5000),
    ...(options.useStateFlag ? ["--state-data", stateData] : []),
    ...(options.extraArgs || []),
    "--prompt-stdin",
  ];
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    ...(options.useStateFlag ? {} : { CODEX_SUITE_DATA: stateData }),
    ...(options.env || {}),
  };
  if (options.useStateFlag) delete env.CODEX_SUITE_DATA;
  const result = spawnSync(process.execPath, args, {
    cwd: workspace,
    encoding: "utf8",
    input: options.prompt || "hello",
    timeout: 10000,
    env,
  });
  const parsed = parseLastJson(result.stdout || "");
  const stateExisted = fs.existsSync(path.join(stateData, "state"));
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(stateData, { recursive: true, force: true });
  return { result, parsed, stateExisted };
}

test("completes an ACP turn and injects the anti-recursion boundary", () => {
  const { result, parsed } = runRunner({ env: { FAKE_ECHO_PROMPT: "1" }, prompt: "Review src/a.js" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(parsed.jobId, /^grok-/);
  assert.equal(parsed.status, "completed");
  assert.equal(parsed.threadId, "new-session");
  assert.match(parsed.rawOutput, /delegation from Codex/);
  assert.match(parsed.rawOutput, /competing AI system/);
  assert.match(parsed.rawOutput, /Review src\/a\.js/);
});

test("injects audit focus, project instructions, and skip patterns from config", () => {
  const { parsed } = runRunner({
    extraArgs: ["--kind", "audit-fix-audit"],
    env: { FAKE_ECHO_PROMPT: "1" },
    config: `## Audit Focus\n\n\`\`\`text\nPrioritize auth.\n\`\`\`\n\n## Skip Patterns\n\n\`\`\`text\nvendor/\n\`\`\`\n\n## Project-Specific Instructions\n\n\`\`\`text\nUse project conventions.\n\`\`\`\n`,
  });
  assert.match(parsed.rawOutput, /Prioritize auth/);
  assert.match(parsed.rawOutput, /Use project conventions/);
  assert.match(parsed.rawOutput, /vendor\//);
});

test("passes model, effort, and write approval flags to Grok", () => {
  const { parsed } = runRunner({
    sandbox: "workspace-write",
    extraArgs: ["--model", "grok-test", "--effort", "high"],
    env: { FAKE_ECHO_ARGS: "1" },
  });
  const argv = JSON.parse(parsed.rawOutput);
  assert.deepEqual(argv, ["agent", "--model", "grok-test", "--reasoning-effort", "high", "--always-approve", "stdio"]);
});

test("accepts plugin lifecycle state storage as a runner flag", () => {
  const { result, stateExisted } = runRunner({ useStateFlag: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(stateExisted, true);
});

test("authenticates in headless mode before Grok session creation", () => {
  const { result, parsed } = runRunner({ env: { FAKE_AUTH_REQUIRED: "1" } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parsed.status, "completed");
  assert.equal(parsed.threadId, "new-session");
});

test("resumes an ACP session when session/load succeeds", () => {
  const { parsed } = runRunner({ extraArgs: ["--resume", "old-session"] });
  assert.equal(parsed.status, "completed");
  assert.equal(parsed.threadId, "old-session");
  assert.equal(parsed.resumed, true);
});

test("reports a fresh-session fallback when resume is unsupported", () => {
  const { parsed } = runRunner({
    extraArgs: ["--resume", "old-session"],
    env: { FAKE_LOAD_FAIL: "1" },
  });
  assert.equal(parsed.status, "completed");
  assert.equal(parsed.threadId, "new-session");
  assert.equal(parsed.resumed, false);
});

test("does not report token-limit output as completed", () => {
  const { result, parsed } = runRunner({ env: { FAKE_STOP: "max_tokens" } });
  assert.notEqual(result.status, 0);
  assert.equal(parsed.status, "failed");
  assert.match(parsed.error, /max_tokens/);
  assert.equal(parsed.rawOutput, "THE ANSWER");
});

test("read-only rejects permissions while workspace-write approves them", () => {
  const readOnly = runRunner({ env: { FAKE_PERMISSION: "1" } }).parsed;
  assert.equal(JSON.parse(readOnly.rawOutput).outcome.optionId, "reject_once");

  const writable = runRunner({ sandbox: "workspace-write", env: { FAKE_PERMISSION: "1" } }).parsed;
  assert.equal(JSON.parse(writable.rawOutput).outcome.optionId, "allow_once");
});

test("workspace-contained modes deny ACP reads outside the workspace", () => {
  const { parsed } = runRunner({ env: { FAKE_OUTSIDE_READ: "/etc/hosts" } });
  assert.match(parsed.rawOutput, /outside workspace/);
});

test("a deadline produces a stalled result", () => {
  const { result, parsed } = runRunner({ timeoutMs: 100, env: { FAKE_HANG: "1" } });
  assert.notEqual(result.status, 0);
  assert.equal(parsed.status, "stalled");
  assert.match(parsed.error, /Timed out/);
});

test("background jobs complete durably and expose their stored result", () => {
  const workspace = tempDir("codex-suite-background-");
  const stateData = tempDir("codex-suite-state-");
  const bin = makeFakeBin(workspace);
  try {
    const started = spawnSync(process.execPath, [
      RUNNER,
      "--background",
      "--kind", "implement",
      "--summary", "fixture implementation",
      "--cwd", workspace,
      "--sandbox", "workspace-write",
      "--timeout-ms", "5000",
      "--prompt-stdin",
    ], {
      cwd: workspace,
      encoding: "utf8",
      input: "implement fixture",
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        CODEX_SUITE_DATA: stateData,
      },
    });
    const queued = parseLastJson(started.stdout);
    assert.equal(started.status, 0, started.stderr);
    assert.equal(queued.status, "queued");
    assert.match(queued.jobId, /^implement-/);

    const completed = waitForJob(
      workspace,
      stateData,
      queued.jobId,
      (job) => job.status === "completed",
    );
    assert.equal(completed.kind, "implement");
    assert.equal(completed.summary, "fixture implementation");

    const result = runJobs("result", workspace, stateData, queued.jobId);
    assert.equal(result.status, 0, result.stderr);
    const payload = parseLastJson(result.stdout);
    assert.equal(payload.job.status, "completed");
    assert.equal(payload.stored.rawOutput, "THE ANSWER");
    assert.equal(payload.stored.threadId, "new-session");

    const stateMode = fs.statSync(path.join(stateData, "state")).mode & 0o777;
    assert.equal(stateMode, 0o700);
    assert.equal(fs.statSync(completed.logFile).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(stateData, { recursive: true, force: true });
  }
});

test("background cancellation terminates the owned worker and records cancelled", () => {
  const workspace = tempDir("codex-suite-cancel-");
  const stateData = tempDir("codex-suite-state-");
  const bin = makeFakeBin(workspace);
  try {
    const started = spawnSync(process.execPath, [
      RUNNER,
      "--background",
      "--kind", "implement",
      "--summary", "hanging fixture",
      "--cwd", workspace,
      "--sandbox", "read-only",
      "--timeout-ms", "60000",
      "--prompt-stdin",
    ], {
      cwd: workspace,
      encoding: "utf8",
      input: "hang",
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        CODEX_SUITE_DATA: stateData,
        FAKE_HANG: "1",
      },
    });
    const queued = parseLastJson(started.stdout);
    assert.equal(started.status, 0, started.stderr);
    const running = waitForJob(
      workspace,
      stateData,
      queued.jobId,
      (job) => job.status === "running" && Number.isSafeInteger(job.pid),
    );
    const cancelled = runJobs("cancel", workspace, stateData, queued.jobId);
    assert.equal(cancelled.status, 0, cancelled.stderr);
    const cancellation = parseLastJson(cancelled.stdout);
    if (running.pidStartedAt) {
      assert.equal(cancellation.terminated, true);
      assert.match(cancellation.outcome, /terminated|already-exited/);
    } else {
      assert.equal(cancellation.terminated, false);
      assert.equal(cancellation.outcome, "unverifiable");
      assert.match(cancellation.detail, /identity could not be proven/);
      process.kill(running.pid, "SIGTERM");
      sleep(150);
    }

    const final = waitForJob(
      workspace,
      stateData,
      queued.jobId,
      (job) => job.status === "cancelled",
    );
    assert.equal(final.phase, "cancelled");
    assert.equal(final.terminationConfirmed, Boolean(running.pidStartedAt));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(stateData, { recursive: true, force: true });
  }
});

test("invalid sandbox values fail before Grok starts", () => {
  const result = spawnSync(process.execPath, [RUNNER, "--sandbox", "readonly", "--", "hello"], {
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid --sandbox/);
});

test("preflight uses Grok's model discovery instead of treating the cache as authoritative", () => {
  const workspace = tempDir("codex-suite-preflight-");
  const bin = makeFakeBin(workspace);
  const grokHome = path.join(workspace, "grok-home");
  fs.mkdirSync(grokHome);
  fs.writeFileSync(path.join(grokHome, "config.toml"), `
[models]
default = "deepseek-v4-flash"

[model.deepseek-v4-flash]
model = "deepseek-v4-flash"
name = "DeepSeek V4 Flash"
`);
  fs.writeFileSync(path.join(grokHome, "models_cache.json"), JSON.stringify({
    default_model: "grok-test",
    models: { "grok-test": { info: { name: "Grok Test", description: "fixture" } } },
  }));
  const result = spawnSync(process.execPath, [PREFLIGHT], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GROK_HOME: grokHome,
      XAI_API_KEY: "test-key-not-secret",
      FAKE_MODELS: "Default model: deepseek-v4-flash\n\nAvailable models:\n  - grok-test\n  * deepseek-v4-flash (default)\n",
    },
  });
  const parsed = parseLastJson(result.stdout);
  fs.rmSync(workspace, { recursive: true, force: true });
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.auth_mode, "api_key");
  assert.equal(parsed.default_model, "deepseek-v4-flash");
  assert.deepEqual(parsed.models, ["grok-test", "deepseek-v4-flash"]);
  assert.deepEqual(parsed.model_sources, ["grok-cli"]);
  assert.equal(parsed.model_discovery, "grok-models");
  assert.equal(parsed.models_authoritative, true);
  assert.equal(parsed.models_detail[1].display_name, "DeepSeek V4 Flash");
  assert.equal(parsed.models_detail[1].source, "grok-cli");
});

test("preflight falls back to configured and cached models when Grok discovery fails", () => {
  const workspace = tempDir("codex-suite-preflight-fallback-");
  const bin = makeFakeBin(workspace);
  const grokHome = path.join(workspace, "grok-home");
  fs.mkdirSync(grokHome);
  fs.writeFileSync(path.join(grokHome, "config.toml"), `
[models]
default = "deepseek-v4-flash"

[model.deepseek-v4-flash]
name = "DeepSeek V4 Flash"
`);
  fs.writeFileSync(path.join(grokHome, "models_cache.json"), JSON.stringify({
    default_model: "grok-test",
    models: { "grok-test": { info: { name: "Grok Test" } } },
  }));
  const result = spawnSync(process.execPath, [PREFLIGHT], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GROK_HOME: grokHome,
      XAI_API_KEY: "test-key-not-secret",
      FAKE_MODELS_FAIL: "1",
    },
  });
  const parsed = parseLastJson(result.stdout);
  fs.rmSync(workspace, { recursive: true, force: true });
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.default_model, "deepseek-v4-flash");
  assert.deepEqual(parsed.models, ["deepseek-v4-flash", "grok-test"]);
  assert.deepEqual(parsed.model_sources, ["config", "cache"]);
  assert.equal(parsed.model_discovery, "config-cache-fallback");
  assert.equal(parsed.models_authoritative, false);
});
