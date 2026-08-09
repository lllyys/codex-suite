import fs from "node:fs";

import {
  isActiveJob,
  isTerminalJob,
  listJobs,
  readJobFile,
  resolveJobFile,
  updateState,
} from "./state.mjs";
import {
  processAlive,
  readProcessStartTime,
  terminateProcessTree,
  waitForExit,
} from "./process.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const TERM_CONFIRM_MS = 1500;
const KILL_CONFIRM_MS = 500;
const PREVIEW_TAIL_BYTES = 64 * 1024;
export const SESSION_ID_ENV = "CODEX_SUITE_SESSION_ID";

export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function filterSession(jobs, options = {}) {
  const sessionId = options.sessionId ?? options.env?.[SESSION_ID_ENV] ?? process.env[SESSION_ID_ENV] ?? null;
  return sessionId && !options.all ? jobs.filter((job) => job.sessionId === sessionId) : jobs;
}

export function readJobProgressPreview(logFile, maxLines = 4) {
  if (!logFile || !fs.existsSync(logFile)) return [];
  let tail;
  let start = 0;
  try {
    const descriptor = fs.openSync(logFile, "r");
    try {
      const size = fs.fstatSync(descriptor).size;
      start = Math.max(0, size - PREVIEW_TAIL_BYTES);
      const buffer = Buffer.alloc(size - start);
      fs.readSync(descriptor, buffer, 0, buffer.length, start);
      tail = buffer.toString("utf8");
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return [];
  }
  if (start > 0) {
    const firstNewline = tail.indexOf("\n");
    tail = firstNewline < 0 ? "" : tail.slice(firstNewline + 1);
  }
  return tail
    .split(/\r?\n/)
    .filter((line) => line.startsWith("["))
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .slice(-maxLines);
}

function duration(startValue, endValue = null) {
  const start = Date.parse(startValue || "");
  const end = endValue ? Date.parse(endValue) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const total = Math.max(0, Math.round((end - start) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function enrichJob(job, options = {}) {
  const active = isActiveJob(job);
  return {
    ...job,
    kindLabel: job.kindLabel || job.kind || "grok",
    phase: job.phase || (active ? "running" : job.status),
    elapsed: duration(job.startedAt || job.createdAt, job.completedAt || null),
    duration: active ? null : duration(job.startedAt || job.createdAt, job.completedAt || job.updatedAt),
    progressPreview: active || job.status === "failed"
      ? readJobProgressPreview(job.logFile, options.maxProgressLines ?? 4)
      : [],
  };
}

function matchReference(jobs, reference) {
  if (!reference) return jobs[0] || null;
  const exact = jobs.find((job) => job.id === reference);
  if (exact) return exact;
  const matches = jobs.filter((job) => job.id.startsWith(reference));
  if (matches.length > 1) throw new Error(`Job reference "${reference}" is ambiguous. Use a longer job id.`);
  if (matches.length === 0) throw new Error(`No job found for "${reference}". Run $grok-status to list known jobs.`);
  return matches[0];
}

export function resolveAnyJob(cwd, reference, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(filterSession(listJobs(workspaceRoot), { ...options, all: Boolean(reference) || options.all }));
  const job = matchReference(jobs, reference);
  if (!job) throw new Error("No Grok jobs recorded for this workspace.");
  return { workspaceRoot, job };
}

export function buildStatusSnapshot(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const jobs = sortJobsNewestFirst(filterSession(listJobs(workspaceRoot), options));
  const running = jobs.filter(isActiveJob).map((job) => enrichJob(job, options));
  const latestRaw = jobs.find(isTerminalJob) || null;
  const latestFinished = latestRaw ? enrichJob(latestRaw, options) : null;
  const recentRaw = jobs.filter((job) => isTerminalJob(job) && job.id !== latestRaw?.id);
  const recent = (options.all ? recentRaw : recentRaw.slice(0, options.maxJobs ?? 8))
    .map((job) => enrichJob(job, options));
  return { workspaceRoot, running, latestFinished, recent };
}

export function resolveResultJob(cwd, reference, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const allJobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  const jobs = reference ? allJobs : filterSession(allJobs, options);
  if (reference) {
    const selected = matchReference(jobs, reference);
    if (isActiveJob(selected)) throw new Error(`Job ${selected.id} is still ${selected.status}. Check $grok-status.`);
    return { workspaceRoot, job: selected };
  }
  const finished = jobs.find(isTerminalJob);
  if (finished) return { workspaceRoot, job: finished };
  const active = jobs.find(isActiveJob);
  if (active) throw new Error(`Job ${active.id} is still ${active.status}. Check $grok-status.`);
  throw new Error("No finished Grok jobs found for this workspace.");
}

export function readStoredJob(workspaceRoot, jobId) {
  const file = resolveJobFile(workspaceRoot, jobId);
  return fs.existsSync(file) ? readJobFile(file) : null;
}

export function resolveCancelableJob(cwd, reference) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const active = sortJobsNewestFirst(listJobs(workspaceRoot)).filter(isActiveJob);
  if (reference) return { workspaceRoot, job: matchReference(active, reference) };
  if (active.length === 1) return { workspaceRoot, job: active[0] };
  if (active.length > 1) throw new Error("Multiple jobs are active. Pass a job id to $grok-cancel.");
  throw new Error("No active Grok jobs to cancel.");
}

export function verifyJobProcess(job) {
  const pid = typeof job?.pid === "number" ? job.pid : Number.NaN;
  if (!Number.isSafeInteger(pid) || pid <= 0) return { pid: null, state: "no-pid" };
  if (!processAlive(pid)) return { pid, state: "gone" };
  if (!job.pidStartedAt) return { pid, state: "unverifiable" };
  const current = readProcessStartTime(pid);
  if (current === null) return { pid, state: "unverifiable" };
  if (current !== job.pidStartedAt) return { pid, state: "recycled" };
  return { pid, state: "ours" };
}

export function terminateJobProcess(job) {
  const identity = verifyJobProcess(job);
  if (identity.state === "no-pid") return { outcome: "no-pid", terminated: false, detail: "no recorded PID, so the job process could not be terminated" };
  if (identity.state === "gone") return { outcome: "already-exited", terminated: true, detail: "the job process had already exited" };
  if (identity.state === "recycled") return { outcome: "already-exited", terminated: true, detail: "the recorded PID was recycled; no unrelated process was signalled" };
  if (identity.state === "unverifiable") return { outcome: "unverifiable", terminated: false, detail: "process identity could not be proven, so it was not signalled" };
  try {
    const delivered = terminateProcessTree(identity.pid, { signal: "SIGTERM" });
    if (delivered.attempted && !delivered.delivered) {
      return { outcome: "already-exited", terminated: true, detail: "the job process had already exited" };
    }
  } catch (error) {
    return { outcome: "signal-failed", terminated: false, detail: `termination failed (${error?.message || error})` };
  }
  let alive = waitForExit([identity.pid], TERM_CONFIRM_MS);
  if (alive.size > 0) {
    if (verifyJobProcess(job).state !== "ours") {
      return { outcome: "already-exited", terminated: true, detail: "the job exited and its PID was reused" };
    }
    try { terminateProcessTree(identity.pid, { signal: "SIGKILL" }); } catch {}
    alive = waitForExit([identity.pid], KILL_CONFIRM_MS);
  }
  return alive.size === 0
    ? { outcome: "terminated", terminated: true, detail: "the job process exited" }
    : { outcome: "not-confirmed", terminated: false, detail: "signals were delivered but exit was not confirmed" };
}

export function cancelJob(cwd, reference) {
  const { workspaceRoot, job } = resolveCancelableJob(cwd, reference);
  const result = terminateJobProcess(job);
  let race = null;
  const completedAt = new Date().toISOString();
  updateState(workspaceRoot, (state) => {
    const index = state.jobs.findIndex((candidate) => candidate.id === job.id);
    if (index < 0) { race = "the job record disappeared during cancellation"; return; }
    if (!isActiveJob(state.jobs[index])) {
      race = `the job finished on its own (${state.jobs[index].status}) before cancellation was recorded`;
      return;
    }
    state.jobs[index] = {
      ...state.jobs[index],
      status: "cancelled",
      phase: "cancelled",
      terminationConfirmed: result.terminated,
      ...(result.terminated ? {} : { errorMessage: `Cancel requested; ${result.detail}.` }),
      completedAt,
      updatedAt: completedAt,
    };
  });
  if (race) return { workspaceRoot, job, outcome: "already-finished", terminated: true, detail: race };
  return { workspaceRoot, job, ...result };
}
