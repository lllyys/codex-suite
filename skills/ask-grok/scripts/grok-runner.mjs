#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  claimJob,
  createJobLogFile,
  generateJobId,
  upsertJob,
  writeJobFile,
} from "./lib/state.mjs";
import {
  installChildSignalForwarding,
  readProcessStartTime,
  terminateProcessTree,
  waitForExit,
} from "./lib/process.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { buildDelegatedPrompt, loadProjectConfig } from "./lib/config.mjs";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const ACP_PROTOCOL_VERSION = 1;
const ANSWER_QUIET_MS = 500;
const ANSWER_DRAIN_MAX_MS = 5000;
const KILL_GRACE_MS = 3000;
const HEARTBEAT_MS = 30_000;
const VALID_SANDBOXES = new Set(["read-only", "workspace-write", "danger-full-access"]);
const VALID_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const BACKGROUND_JOB_ENV = "CODEX_SUITE_BACKGROUND_JOB_ID";
const HOST_SESSION_ENV = "CODEX_SUITE_SESSION_ID";

let activeJobId = null;

const DELEGATION_BOUNDARY = [
  "This request already reached you by delegation from Codex.",
  "You are the agent that does the work, not a router for it.",
  "Perform the task yourself and return the result directly to Codex.",
  "Do not invoke ask-grok or any workspace skill that delegates the task again.",
  "Returning the work to its delegator would create a recursive loop.",
].join(" ");

function fail(message) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const args = {
    kind: "grok",
    summary: null,
    model: null,
    effort: null,
    sandbox: "read-only",
    resume: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    cwd: null,
    promptStdin: false,
    prompt: null,
    debug: false,
    background: false,
    hostSessionId: null,
    stateData: null,
  };
  const valueFlags = new Set([
    "--kind", "--summary", "--model", "--effort", "--sandbox", "--resume",
    "--timeout-ms", "--cwd", "--host-session-id", "--state-data",
  ]);
  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--") {
      args.prompt = argv.slice(i + 1).join(" ");
      break;
    }
    if (arg === "--prompt-stdin") {
      args.promptStdin = true;
      i += 1;
      continue;
    }
    if (arg === "--debug") {
      args.debug = true;
      i += 1;
      continue;
    }
    if (arg === "--background") {
      args.background = true;
      i += 1;
      continue;
    }
    if (!valueFlags.has(arg)) fail(`unknown option '${arg}'`);
    const value = takeValue(argv, i, arg);
    i += 2;
    if (arg === "--kind") args.kind = value;
    else if (arg === "--summary") args.summary = value;
    else if (arg === "--model") args.model = value;
    else if (arg === "--effort") args.effort = value;
    else if (arg === "--sandbox") args.sandbox = value;
    else if (arg === "--resume") args.resume = value;
    else if (arg === "--cwd") args.cwd = value;
    else if (arg === "--host-session-id") args.hostSessionId = value;
    else if (arg === "--state-data") args.stateData = value;
    else if (arg === "--timeout-ms") {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2_147_483_647) {
        fail(`--timeout-ms requires an integer from 1 to 2147483647, got '${value}'`);
      }
      args.timeoutMs = parsed;
    }
  }
  if (!VALID_SANDBOXES.has(args.sandbox)) {
    fail(`invalid --sandbox '${args.sandbox}' (expected read-only, workspace-write, or danger-full-access)`);
  }
  if (args.effort && !VALID_EFFORTS.has(args.effort)) {
    fail(`invalid --effort '${args.effort}'`);
  }
  if (args.promptStdin && args.prompt !== null) fail("use either --prompt-stdin or '-- <prompt>', not both");
  if (args.promptStdin) args.prompt = fs.readFileSync(0, "utf8");
  if (!args.prompt?.trim()) fail("no prompt provided; use --prompt-stdin or -- <prompt>");
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(args.kind)) fail(`invalid --kind '${args.kind}'`);
  return args;
}

function terminateTree(pid, signal = "SIGTERM") {
  try { terminateProcessTree(pid, { signal }); } catch {}
}

function appendLog(logFile, message) {
  if (!logFile) return;
  try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`, "utf8"); } catch {}
}

function buildGrokArgs(args) {
  const grokArgs = ["agent"];
  if (args.model) grokArgs.push("--model", args.model);
  if (args.effort) grokArgs.push("--reasoning-effort", args.effort);
  if (args.sandbox !== "read-only") grokArgs.push("--always-approve");
  grokArgs.push("stdio");
  return grokArgs;
}

function executeGrok(cwd, args, logFile, jobId) {
  return new Promise((resolve) => {
    const alwaysApprove = args.sandbox !== "read-only";
    const grokArgs = buildGrokArgs(args);
    appendLog(logFile, `Exec: grok ${grokArgs.join(" ")} (ACP client)`);
    appendLog(logFile, `Model: ${args.model || "(default)"}, effort: ${args.effort || "(default)"}, sandbox: ${args.sandbox}`);
    appendLog(logFile, `Deadline: ${Math.round(args.timeoutMs / 1000)}s`);
    const child = spawn("grok", grokArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      detached: process.platform !== "win32",
    });

    let nextId = 1;
    let buffer = "";
    let stderrTail = "";
    let answer = [];
    let toolCalls = 0;
    let sessionId = args.resume || null;
    let resumeFellBack = false;
    let lastChunkAt = 0;
    let childClosed = false;
    let settled = false;
    let timedOut = false;
    let phase = "spawn";
    const pending = new Map();
    const debug = (message) => {
      if (args.debug) process.stderr.write(`[grok-acp] ${message}\n`);
      appendLog(logFile, message);
    };
    const send = (message) => {
      if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const rpc = (method, params) => new Promise((accept, reject) => {
      const id = nextId++;
      pending.set(id, { accept, reject });
      debug(`>> ${method} id=${id}`);
      send({ jsonrpc: "2.0", id, method, params });
    });
    const respond = (id, result) => send({ jsonrpc: "2.0", id, result });
    const respondError = (id, message) => send({
      jsonrpc: "2.0", id, error: { code: -32601, message },
    });
    const rejectPending = (reason) => {
      for (const { reject } of pending.values()) reject(reason);
      pending.clear();
    };

    const releaseSignals = installChildSignalForwarding(child);

    function setPhase(next) {
      phase = next;
      appendLog(logFile, `Phase: ${next}`);
      try { claimJob(cwd, jobId, { phase: next }, { unless: ["cancelled"] }); } catch {}
    }

    const heartbeat = setInterval(() => {
      appendLog(logFile, `…still running (${toolCalls} tool call(s), phase=${phase})`);
    }, HEARTBEAT_MS);

    let killTimer = null;
    const deadline = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      debug(`deadline exceeded after ${args.timeoutMs}ms`);
      if (sessionId) send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
      terminateTree(child.pid);
      killTimer = setTimeout(() => {
        terminateTree(child.pid, "SIGKILL");
        finish({
          status: "stalled",
          error: `Timed out after ${Math.round(args.timeoutMs / 1000)}s`,
          threadId: sessionId,
          rawOutput: answer.join("").trim(),
        });
      }, KILL_GRACE_MS);
    }, args.timeoutMs);

    function finish(result) {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      releaseSignals();
      terminateTree(child.pid);
      resolve({
        ...result,
        toolCalls,
        ...(args.resume ? { resumed: !resumeFellBack } : {}),
      });
    }

    child.stdin.on("error", (error) => rejectPending(new Error(`grok stdin closed: ${error.message}`)));

    let canonicalRoot = cwd;
    try { canonicalRoot = fs.realpathSync.native(cwd); } catch { /* keep resolved cwd */ }
    function resolveClientPath(rawPath, forWrite) {
      const resolved = path.resolve(cwd, String(rawPath ?? ""));
      if (args.sandbox === "danger-full-access") return resolved;
      let canonical = resolved;
      try {
        canonical = forWrite
          ? path.join(fs.realpathSync.native(path.dirname(resolved)), path.basename(resolved))
          : fs.realpathSync.native(resolved);
      } catch { /* missing paths are checked lexically */ }
      const relative = path.relative(canonicalRoot, canonical);
      const inside = relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
      return inside ? resolved : null;
    }

    function handleRequest(message) {
      if (message.method === "session/request_permission") {
        const options = message.params?.options || [];
        const wanted = alwaysApprove ? /allow|approve|yes/i : /reject|deny|no/i;
        const selected = options.find((option) =>
          wanted.test(option.optionId || option.kind || option.name || "")
        );
        if (!selected) {
          respond(message.id, { outcome: { outcome: "cancelled" } });
        } else {
          respond(message.id, { outcome: { outcome: "selected", optionId: selected.optionId } });
        }
      } else if (message.method === "fs/read_text_file") {
        const target = resolveClientPath(message.params?.path, false);
        if (!target) return respondError(message.id, `path outside workspace: ${message.params?.path}`);
        try { respond(message.id, { content: fs.readFileSync(target, "utf8") }); }
        catch (error) { respondError(message.id, String(error)); }
      } else if (message.method === "fs/write_text_file") {
        if (!alwaysApprove) return respondError(message.id, "read-only: write denied");
        const target = resolveClientPath(message.params?.path, true);
        if (!target) return respondError(message.id, `path outside workspace: ${message.params?.path}`);
        try {
          fs.writeFileSync(target, message.params?.content ?? "", "utf8");
          respond(message.id, {});
        } catch (error) { respondError(message.id, String(error)); }
      } else {
        respondError(message.id, `unsupported client method: ${message.method}`);
      }
    }

    function handleNotification(message) {
      if (message.method !== "session/update") return;
      const update = message.params?.update || {};
      if (update.sessionUpdate === "agent_message_chunk") {
        answer.push(update.content?.text ?? "");
        lastChunkAt = Date.now();
      } else if (update.sessionUpdate === "tool_call") {
        toolCalls += 1;
        appendLog(logFile, `tool_call: ${update.title || update.tool || update.toolCallId || "unknown"}`);
      }
    }

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try { message = JSON.parse(line); } catch { debug("ignored non-JSON stdout line"); continue; }
        if (message.id !== undefined && (message.result !== undefined || message.error !== undefined) && pending.has(message.id)) {
          const waiter = pending.get(message.id);
          pending.delete(message.id);
          debug(`<< response id=${message.id}`);
          message.error ? waiter.reject(message.error) : waiter.accept(message.result);
        } else if (message.method && message.id !== undefined) {
          handleRequest(message);
        } else if (message.method) {
          handleNotification(message);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderrTail = `${stderrTail}${text}`.slice(-4000);
      try { fs.appendFileSync(logFile, text, "utf8"); } catch {}
    });
    child.on("error", (error) => {
      const message = error.code === "ENOENT"
        ? "grok not found on PATH. Install Grok Build from https://x.ai/cli"
        : error.message;
      rejectPending(new Error(message));
      finish({ status: "failed", error: message, threadId: null, rawOutput: "" });
    });
    child.on("close", (code, signal) => {
      childClosed = true;
      rejectPending(new Error(`grok exited (${code === null ? `signal ${signal}` : `code ${code}`})`));
      if (settled || phase === "done") return;
      if (timedOut) {
        return finish({
          status: "stalled",
          error: `Timed out after ${Math.round(args.timeoutMs / 1000)}s`,
          threadId: sessionId,
          rawOutput: answer.join("").trim(),
        });
      }
      finish({
        status: "failed",
        error: stderrTail.trim() || `grok exited during ${phase} (${code === null ? `signal ${signal}` : `code ${code}`})`,
        threadId: sessionId,
        rawOutput: answer.join("").trim(),
      });
    });

    async function drainAnswer() {
      const hardStop = Date.now() + ANSWER_DRAIN_MAX_MS;
      const drainStartedAt = Date.now();
      while (!childClosed && Date.now() < hardStop) {
        const reference = lastChunkAt || drainStartedAt;
        if (Date.now() - reference >= ANSWER_QUIET_MS) return;
        await new Promise((accept) => setTimeout(accept, 100));
      }
    }

    (async () => {
      try {
        setPhase("initialize");
        const initialized = await rpc("initialize", {
          protocolVersion: ACP_PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        });
        const negotiated = initialized?.protocolVersion;
        if (negotiated !== undefined && (typeof negotiated !== "number" || negotiated < 1)) {
          return finish({
            status: "failed",
            error: `grok negotiated an unsupported ACP protocol version: ${JSON.stringify(negotiated)}`,
            threadId: null,
            rawOutput: "",
          });
        }

        const authMethods = Array.isArray(initialized?.authMethods) ? initialized.authMethods : [];
        const newSession = () => rpc("session/new", { cwd, mcpServers: [] });
        if (authMethods.length > 0) {
          const ids = authMethods.map((method) => method?.id).filter(Boolean);
          const methodId =
            (process.env.XAI_API_KEY && ids.includes("xai.api_key") ? "xai.api_key" : null) ||
            (ids.includes("cached_token") ? "cached_token" : null);
          if (!methodId) {
            throw new Error(`grok requires interactive authentication (${ids.join(", ") || "no methods"}); run 'grok login'`);
          }
          setPhase("authenticate");
          await rpc("authenticate", { methodId, _meta: { headless: true } });
        }

        setPhase("session");
        if (args.resume) {
          try {
            await rpc("session/load", { sessionId: args.resume, cwd, mcpServers: [] });
            sessionId = args.resume;
          } catch {
            resumeFellBack = true;
            const session = await newSession();
            sessionId = session?.sessionId || null;
          }
        } else {
          const session = await newSession();
          sessionId = session?.sessionId || null;
        }
        if (!sessionId) {
          return finish({ status: "failed", error: "grok returned no sessionId", threadId: null, rawOutput: "" });
        }

        answer = [];
        toolCalls = 0;
        lastChunkAt = 0;
        setPhase("prompt");
        const promptResult = await rpc("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: buildDelegatedPrompt(cwd, args.kind, args.prompt, DELEGATION_BOUNDARY) }],
        });
        setPhase("done");
        await drainAnswer();
        if (settled) return;

        const rawOutput = answer.join("").trim();
        const stopReason = promptResult?.stopReason;
        if (stopReason === "end_turn" || stopReason === "endTurn" || (stopReason === undefined && rawOutput)) {
          finish({ status: "completed", threadId: sessionId, rawOutput });
        } else if (stopReason === "cancelled" || stopReason === "canceled") {
          finish({ status: "stalled", error: `grok stopReason=${stopReason}`, threadId: sessionId, rawOutput });
        } else if (stopReason === "refusal") {
          finish({ status: "failed", error: "grok refused the request", threadId: sessionId, rawOutput });
        } else if (stopReason === "max_tokens" || stopReason === "max_turn_requests") {
          finish({ status: "failed", error: `grok stopped at a limit (${stopReason}); output may be truncated`, threadId: sessionId, rawOutput });
        } else if (stopReason === undefined) {
          finish({ status: "failed", error: "grok returned no stopReason and no answer", threadId: sessionId, rawOutput });
        } else {
          finish({ status: "failed", error: `unrecognized Grok stopReason: ${JSON.stringify(stopReason)}`, threadId: sessionId, rawOutput });
        }
      } catch (error) {
        if (!settled) finish({
          status: "failed",
          error: error?.message || JSON.stringify(error),
          threadId: sessionId,
          rawOutput: answer.join("").trim(),
        });
      }
    })();
  });
}

function hostSessionId(args) {
  return args.hostSessionId || process.env[HOST_SESSION_ENV] || null;
}

function initialJob(cwd, args, jobId, logFile, status) {
  return {
    id: jobId,
    kind: args.kind,
    status,
    phase: status === "queued" ? "queued" : "spawn",
    summary: args.summary || `${args.kind} task`,
    sessionId: hostSessionId(args),
    model: args.model,
    effort: args.effort,
    sandbox: args.sandbox,
    logFile,
  };
}

async function executeAndPersist(cwd, args, jobId, logFile) {
  const result = await executeGrok(cwd, args, logFile, jobId);
  const completedAt = new Date().toISOString();
  const finalized = claimJob(cwd, jobId, {
    status: result.status,
    phase: result.status,
    threadId: result.threadId || null,
    completedAt,
    ...(result.error ? { errorMessage: result.error } : {}),
  }, { unless: ["cancelled"] });
  writeJobFile(cwd, jobId, {
    rawOutput: result.rawOutput || "",
    threadId: result.threadId || null,
    toolCalls: result.toolCalls || 0,
    ...(typeof result.resumed === "boolean" ? { resumed: result.resumed } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(!finalized ? { note: "Result arrived after cancellation; the cancelled job state was preserved." } : {}),
  });
  return { jobId, ...result };
}

async function runForeground(cwd, args) {
  const jobId = generateJobId(args.kind);
  activeJobId = jobId;
  const logFile = createJobLogFile(cwd, jobId);
  const startedAt = new Date().toISOString();
  upsertJob(cwd, {
    ...initialJob(cwd, args, jobId, logFile, "running"),
    pid: process.pid,
    pidStartedAt: readProcessStartTime(process.pid),
    startedAt,
    deadlineAt: new Date(Date.now() + args.timeoutMs).toISOString(),
  });
  appendLog(logFile, `Starting ${args.kind} task (foreground, backend=grok/ACP)`);
  const output = await executeAndPersist(cwd, args, jobId, logFile);
  activeJobId = null;
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (output.status !== "completed") process.exitCode = 1;
}

function workerArguments(cwd, args) {
  const argv = [
    fileURLToPath(import.meta.url),
    "--kind", args.kind,
    "--sandbox", args.sandbox,
    "--timeout-ms", String(args.timeoutMs),
    "--cwd", cwd,
  ];
  if (args.summary) argv.push("--summary", args.summary);
  if (args.model) argv.push("--model", args.model);
  if (args.effort) argv.push("--effort", args.effort);
  if (args.resume) argv.push("--resume", args.resume);
  if (hostSessionId(args)) argv.push("--host-session-id", hostSessionId(args));
  if (args.stateData) argv.push("--state-data", args.stateData);
  if (args.debug) argv.push("--debug");
  argv.push("--", args.prompt);
  return argv;
}

function runBackground(cwd, args) {
  const jobId = generateJobId(args.kind);
  activeJobId = jobId;
  const logFile = createJobLogFile(cwd, jobId);
  upsertJob(cwd, initialJob(cwd, args, jobId, logFile, "queued"));
  appendLog(logFile, `Queued ${args.kind} task (background, backend=grok/ACP)`);

  const child = spawn(process.execPath, workerArguments(cwd, args), {
    cwd,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, [BACKGROUND_JOB_ENV]: jobId },
  });
  child.on("error", (error) => {
    appendLog(logFile, `Background spawn error: ${error.message}`);
    try {
      upsertJob(cwd, {
        id: jobId,
        status: "failed",
        phase: "failed",
        errorMessage: `Failed to start background worker: ${error.message}`,
        completedAt: new Date().toISOString(),
      });
    } catch {}
  });
  child.unref();
  activeJobId = null;
  process.stdout.write(`${JSON.stringify({
    jobId,
    status: "queued",
    message: `Job ${jobId} started in background.`,
  })}\n`);
}

async function runBackgroundWorker(cwd, args, jobId) {
  const logFile = createJobLogFile(cwd, jobId);
  const claimed = claimJob(cwd, jobId, {
    status: "running",
    phase: "spawn",
    pid: process.pid,
    pidStartedAt: readProcessStartTime(process.pid),
    startedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + args.timeoutMs).toISOString(),
  });
  if (!claimed) {
    appendLog(logFile, "Background worker exiting because the queued job was cancelled or removed");
    return;
  }
  appendLog(logFile, "Background worker started (backend=grok/ACP)");
  await executeAndPersist(cwd, args, jobId, logFile);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.stateData) process.env.CODEX_SUITE_DATA = path.resolve(args.stateData);
  const requestedCwd = path.resolve(args.cwd || process.cwd());
  let stat;
  try { stat = fs.statSync(requestedCwd); } catch { fail(`workspace does not exist: ${requestedCwd}`); }
  if (!stat.isDirectory()) fail(`workspace is not a directory: ${requestedCwd}`);
  const cwd = resolveWorkspaceRoot(requestedCwd);
  const config = loadProjectConfig(cwd);
  // Model and effort pins apply to direct CLI use as well as skill calls.
  // Dynamic "latest" leaves model discovery to Grok. Permissions remain an
  // explicit runner argument so configuration cannot silently widen access.
  args.model ||= config.defaultModel === "latest" ? null : config.defaultModel;
  args.effort ||= config.defaultEffort;
  if (args.effort && !VALID_EFFORTS.has(args.effort)) fail(`invalid configured effort '${args.effort}'`);
  const backgroundJobId = process.env[BACKGROUND_JOB_ENV];
  if (backgroundJobId) return runBackgroundWorker(cwd, args, backgroundJobId);
  if (args.background) return runBackground(cwd, args);
  return runForeground(cwd, args);
}

main().catch((error) => {
  const message = error?.message || String(error);
  const jobId = process.env[BACKGROUND_JOB_ENV] || activeJobId;
  if (jobId) {
    try {
      const cwd = resolveWorkspaceRoot(process.cwd());
      claimJob(cwd, jobId, {
        status: "failed",
        phase: "failed",
        errorMessage: message,
        completedAt: new Date().toISOString(),
      }, { unless: ["cancelled"] });
    } catch {}
  }
  if (!process.env[BACKGROUND_JOB_ENV]) {
    process.stdout.write(`${JSON.stringify({ jobId: jobId || null, status: "failed", error: message })}\n`);
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exitCode = 1;
});
