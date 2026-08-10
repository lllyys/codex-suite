import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
const STATE_DATA_ENV = "CODEX_SUITE_DATA";
const FALLBACK_ROOT = path.join(os.tmpdir(), "codex-suite");
const STATE_FILE = "state.json";
const JOBS_DIR = "jobs";
const LOCK_DIR = "state.lock";
const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 15_000;
const MAX_JOBS = 50;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const JOB_PREFIX = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const heldLocks = new Set();

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function assertJobId(jobId) {
  if (typeof jobId !== "string" || !JOB_ID.test(jobId)) {
    throw new Error(`codex-suite: invalid job id ${JSON.stringify(jobId)}`);
  }
}

function defaultState() {
  return { version: STATE_VERSION, jobs: [] };
}

export function resolveStateDataRoot() {
  return path.resolve(process.env[STATE_DATA_ENV] || FALLBACK_ROOT);
}

export function resolveStateDir(cwd) {
  const workspace = resolveWorkspaceRoot(cwd);
  let canonical = workspace;
  try { canonical = fs.realpathSync.native(workspace); } catch {}
  const slug = (path.basename(workspace) || "workspace")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  const root = resolveStateDataRoot();
  return path.join(root, "state", `${slug}-${hash}`);
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), JOBS_DIR);
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), STATE_FILE);
}

function hardenDir(directory) {
  let stat;
  try { stat = fs.lstatSync(directory); } catch { return; }
  if (stat.isSymbolicLink()) {
    throw new Error(`codex-suite: refusing symlinked state directory: ${directory}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    try { fs.chmodSync(directory, 0o700); } catch {}
  }
}

export function ensureStateDir(cwd) {
  const stateDir = resolveStateDir(cwd);
  const jobsDir = resolveJobsDir(cwd);
  fs.mkdirSync(jobsDir, { recursive: true, mode: 0o700 });
  hardenDir(stateDir);
  hardenDir(jobsDir);
}

function withLock(cwd, callback) {
  const lockDir = path.join(resolveStateDir(cwd), LOCK_DIR);
  if (heldLocks.has(lockDir)) return callback();
  ensureStateDir(cwd);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let ownInode = null;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      ownInode = fs.lstatSync(lockDir).ino;
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    let holder = null;
    try { holder = fs.lstatSync(lockDir); } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (holder?.isDirectory() && Date.now() - holder.mtimeMs > LOCK_STALE_MS) {
      try {
        const current = fs.lstatSync(lockDir);
        if (current.ino === holder.ino) fs.rmdirSync(lockDir);
      } catch {}
    }
    if (Date.now() > deadline) throw new Error(`codex-suite: timed out waiting for state lock at ${lockDir}`);
    sleepSync(25);
  }
  heldLocks.add(lockDir);
  try {
    return callback();
  } finally {
    heldLocks.delete(lockDir);
    try {
      const current = fs.lstatSync(lockDir);
      if (current.ino === ownInode) fs.rmdirSync(lockDir);
    } catch {}
  }
}

function quarantine(file, cause) {
  const target = `${file}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(file, target);
    process.stderr.write(`codex-suite: quarantined unreadable state to ${target} (${cause?.message || cause})\n`);
  } catch {
    process.stderr.write(`codex-suite: state is unreadable (${cause?.message || cause}); using defaults\n`);
  }
}

export function loadState(cwd) {
  const file = resolveStateFile(cwd);
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return defaultState();
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.jobs)) {
      throw new Error("invalid state shape");
    }
    return {
      version: STATE_VERSION,
      jobs: parsed.jobs.filter((job) => job && typeof job === "object" && JOB_ID.test(job.id || "")),
    };
  } catch (error) {
    quarantine(file, error);
    return defaultState();
  }
}

export function isActiveJob(job) {
  return job.status === "queued" || job.status === "running";
}

export function isTerminalJob(job) {
  return !isActiveJob(job);
}

function writeAtomic(file, content) {
  const temporary = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const descriptor = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(descriptor, content, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function prune(jobs) {
  const sorted = [...jobs].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const active = sorted.filter(isActiveJob);
  return [...active, ...sorted.filter(isTerminalJob).slice(0, Math.max(0, MAX_JOBS - active.length))];
}

function persistState(cwd, state, previousJobs = []) {
  ensureStateDir(cwd);
  const inputJobs = state.jobs || [];
  const jobs = prune(inputJobs);
  writeAtomic(resolveStateFile(cwd), `${JSON.stringify({ version: STATE_VERSION, jobs }, null, 2)}\n`);

  const retained = new Set(jobs.map((job) => job.id));
  const jobsDir = path.resolve(resolveJobsDir(cwd));
  const removed = new Set([...previousJobs, ...inputJobs]
    .map((job) => job?.id)
    .filter((id) => typeof id === "string" && JOB_ID.test(id) && !retained.has(id)));
  for (const id of removed) {
    for (const extension of ["json", "log"]) {
      const candidate = path.resolve(jobsDir, `${id}.${extension}`);
      if (!candidate.startsWith(`${jobsDir}${path.sep}`)) continue;
      try { fs.unlinkSync(candidate); } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return { version: STATE_VERSION, jobs };
}

export function saveState(cwd, state) {
  return withLock(cwd, () => {
    const previous = loadState(cwd).jobs;
    return persistState(cwd, state, previous);
  });
}

export function updateState(cwd, mutate) {
  return withLock(cwd, () => {
    const state = loadState(cwd);
    const previous = [...state.jobs];
    mutate(state);
    return persistState(cwd, state, previous);
  });
}

export function generateJobId(prefix = "grok") {
  if (typeof prefix !== "string" || !JOB_PREFIX.test(prefix)) {
    throw new Error(`codex-suite: invalid job id prefix ${JSON.stringify(prefix)}`);
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function upsertJob(cwd, patch) {
  assertJobId(patch?.id);
  return updateState(cwd, (state) => {
    const now = new Date().toISOString();
    const index = state.jobs.findIndex((job) => job.id === patch.id);
    if (index === -1) {
      state.jobs.unshift({ createdAt: now, updatedAt: now, ...patch });
    } else {
      state.jobs[index] = { ...state.jobs[index], ...patch, updatedAt: now };
    }
  });
}

export function claimJob(cwd, jobId, patch, options = {}) {
  assertJobId(jobId);
  const unless = options.unless || ["cancelled"];
  let claimed = false;
  updateState(cwd, (state) => {
    const index = state.jobs.findIndex((job) => job.id === jobId);
    if (index < 0 || unless.includes(state.jobs[index].status)) return;
    state.jobs[index] = { ...state.jobs[index], ...patch, updatedAt: new Date().toISOString() };
    claimed = true;
  });
  return claimed;
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

export function resolveJobFile(cwd, jobId) {
  assertJobId(jobId);
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}

export function resolveJobLogFile(cwd, jobId) {
  assertJobId(jobId);
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function createJobLogFile(cwd, jobId) {
  const file = resolveJobLogFile(cwd, jobId);
  fs.closeSync(fs.openSync(file, "a", 0o600));
  try { fs.chmodSync(file, 0o600); } catch {}
  return file;
}

export function writeJobFile(cwd, jobId, payload) {
  const file = resolveJobFile(cwd, jobId);
  writeAtomic(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

export function readJobFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
