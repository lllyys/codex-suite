#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

import { verifyJobProcess } from "../skills/ask-grok/scripts/lib/job-control.mjs";
import { terminateProcessTree, waitForExit } from "../skills/ask-grok/scripts/lib/process.mjs";
import {
  isActiveJob,
  loadState,
  resolveStateFile,
  updateState,
} from "../skills/ask-grok/scripts/lib/state.mjs";
import { resolveWorkspaceRoot } from "../skills/ask-grok/scripts/lib/workspace.mjs";

const TERM_CONFIRM_MS = 1500;
const KILL_CONFIRM_MS = 500;

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("hook input must be a JSON object");
  }
  return parsed;
}

export function cleanupSessionJobs(cwd, sessionId) {
  if (!cwd || !sessionId) return;
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  if (!fs.existsSync(resolveStateFile(workspaceRoot))) return;
  const sessionJobs = loadState(workspaceRoot).jobs.filter((job) => job.sessionId === sessionId);
  if (sessionJobs.length === 0) return;

  const removableIds = new Set();
  const retainedNotes = new Map();
  const signalled = new Map();

  for (const job of sessionJobs) {
    if (!isActiveJob(job)) {
      if (job.terminationConfirmed === false) {
        const identity = verifyJobProcess(job);
        if (identity.state === "gone" || identity.state === "recycled") removableIds.add(job.id);
      } else {
        removableIds.add(job.id);
      }
      continue;
    }
    const identity = verifyJobProcess(job);
    if (identity.state === "gone" || identity.state === "recycled") {
      removableIds.add(job.id);
    } else if (identity.state === "no-pid") {
      retainedNotes.set(job.id, "Session ended; no recorded PID, so the job process could not be terminated.");
    } else if (identity.state === "unverifiable") {
      retainedNotes.set(job.id, "Session ended; process identity could not be proven, so it was not signalled and may still be running.");
    } else {
      try {
        const delivered = terminateProcessTree(identity.pid, { signal: "SIGTERM" });
        if (delivered.attempted && !delivered.delivered) removableIds.add(job.id);
        else signalled.set(job.id, identity.pid);
      } catch {
        retainedNotes.set(job.id, "Session ended; terminating the job process failed, so it may still be running.");
      }
    }
  }

  if (signalled.size > 0) {
    let alive = waitForExit([...signalled.values()], TERM_CONFIRM_MS);
    if (alive.size > 0) {
      for (const [jobId, pid] of signalled) {
        if (!alive.has(pid)) continue;
        const job = sessionJobs.find((candidate) => candidate.id === jobId);
        if (job && verifyJobProcess(job).state !== "ours") { alive.delete(pid); continue; }
        try { terminateProcessTree(pid, { signal: "SIGKILL" }); } catch {}
      }
      alive = waitForExit([...alive], KILL_CONFIRM_MS);
    }
    for (const [jobId, pid] of signalled) {
      if (alive.has(pid)) {
        retainedNotes.set(jobId, "Session ended; termination was requested but process exit was not confirmed.");
      } else {
        removableIds.add(jobId);
      }
    }
  }

  if (removableIds.size === 0 && retainedNotes.size === 0) return;
  const timestamp = new Date().toISOString();
  updateState(workspaceRoot, (state) => {
    state.jobs = state.jobs
      .filter((job) => !(removableIds.has(job.id) && job.sessionId === sessionId))
      .map((job) => retainedNotes.has(job.id) && job.sessionId === sessionId && isActiveJob(job)
        ? {
            ...job,
            status: "cancelled",
            phase: "cancelled",
            terminationConfirmed: false,
            errorMessage: retainedNotes.get(job.id),
            completedAt: timestamp,
            updatedAt: timestamp,
          }
        : job);
  });
}

export function sessionStartOutput(sessionId, stateData = null) {
  if (!sessionId) return null;
  const stateInstruction = stateData ? ` Also pass --state-data ${JSON.stringify(stateData)}.` : "";
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `Codex Suite session id: ${sessionId}. Whenever invoking a codex-suite Grok runner in this root session, pass --host-session-id ${sessionId}.${stateInstruction} For no-argument grok-status or grok-result calls, pass --session-id ${sessionId}${stateData ? ` and --state-data ${JSON.stringify(stateData)}` : ""}. This keeps job queries and SessionEnd cleanup scoped to this session.`,
    },
  };
}

function main() {
  const input = readHookInput();
  const eventName = process.argv[2] || input.hook_event_name || "";
  const pluginData = process.env.PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || null;
  if (!process.env.CODEX_SUITE_DATA && pluginData) process.env.CODEX_SUITE_DATA = pluginData;
  if (eventName === "SessionStart") {
    const output = sessionStartOutput(input.session_id, pluginData);
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } else if (eventName === "SessionEnd") {
    cleanupSessionJobs(input.cwd || process.cwd(), input.session_id);
  }
}

try { main(); }
catch (error) {
  process.stderr.write(`codex-suite session hook failed: ${error?.message || error}\n`);
  process.exitCode = 1;
}
