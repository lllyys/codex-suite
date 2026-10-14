#!/usr/bin/env node

import process from "node:process";
import path from "node:path";

import {
  buildStatusSnapshot,
  cancelJob,
  enrichJob,
  readStoredJob,
  resolveAnyJob,
  resolveResultJob,
} from "../../ask-grok/scripts/lib/job-control.mjs";

function parse(argv) {
  const command = argv[2];
  if (!new Set(["status", "result", "cancel"]).has(command)) {
    throw new Error("usage: opencode-jobs.mjs status|result|cancel [job-id] [--all] [--session-id <id>] [--state-data <path>] [--cwd <path>]");
  }
  let cwd = process.cwd();
  let reference = null;
  let all = false;
  let sessionId = null;
  let stateData = null;
  for (let i = 3; i < argv.length; i += 1) {
    if (argv[i] === "--all") { all = true; continue; }
    if (argv[i] === "--json") continue;
    if (argv[i] === "--session-id") {
      if (!argv[i + 1]) throw new Error("--session-id requires a value");
      sessionId = argv[++i];
      continue;
    }
    if (argv[i] === "--state-data") {
      if (!argv[i + 1]) throw new Error("--state-data requires a value");
      stateData = argv[++i];
      continue;
    }
    if (argv[i] === "--cwd") {
      if (!argv[i + 1]) throw new Error("--cwd requires a value");
      cwd = argv[++i];
      continue;
    }
    if (argv[i].startsWith('--') || reference !== null) throw new Error(`unexpected argument '${argv[i]}'`);
    reference = argv[i];
  }
  return { command, cwd, reference, all, sessionId, stateData };
}

try {
  const args = parse(process.argv);
  if (args.stateData) process.env.CODEX_SUITE_DATA = path.resolve(args.stateData);
  let output;
  if (args.command === "status") {
    if (args.reference) {
      const { workspaceRoot, job } = resolveAnyJob(args.cwd, args.reference, { all: true, backend: "opencode" });
      output = { workspaceRoot, job: enrichJob(job, { maxProgressLines: 20 }) };
    } else {
      output = buildStatusSnapshot(args.cwd, { all: args.all, sessionId: args.sessionId, backend: "opencode" });
    }
  } else if (args.command === "result") {
    const { workspaceRoot, job } = resolveResultJob(args.cwd, args.reference || undefined, { sessionId: args.sessionId, backend: "opencode" });
    output = { workspaceRoot, job: enrichJob(job), stored: readStoredJob(workspaceRoot, job.id) };
  } else {
    output = cancelJob(args.cwd, args.reference || undefined, { backend: "opencode", sessionId: args.sessionId });
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
}
