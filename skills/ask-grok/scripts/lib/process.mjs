import { spawnSync } from "node:child_process";
import process from "node:process";

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    stdio: options.stdio ?? "pipe",
    timeout: options.timeout,
  });
  return {
    command,
    args,
    status: result.status ?? null,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

export function terminateProcessTree(pid, options = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return { attempted: false, delivered: false, method: null };
  }
  const killImpl = options.killImpl ?? process.kill.bind(process);
  const signal = options.signal ?? "SIGTERM";
  if (process.platform !== "win32") {
    try {
      killImpl(-pid, signal);
      return { attempted: true, delivered: true, method: "process-group" };
    } catch {
      // A child may not be a process-group leader; fall back to its PID.
    }
  }
  try {
    killImpl(pid, signal);
    return { attempted: true, delivered: true, method: "process" };
  } catch (error) {
    if (error?.code === "ESRCH") {
      return { attempted: true, delivered: false, method: "process" };
    }
    throw error;
  }
}

export function installChildSignalForwarding(child, signals = ["SIGINT", "SIGTERM", "SIGHUP"]) {
  const handlers = new Map();
  const release = () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    handlers.clear();
  };
  for (const signal of signals) {
    const handler = () => {
      try { terminateProcessTree(child.pid, { signal: "SIGTERM" }); } catch {}
      release();
      try { process.kill(process.pid, signal); } catch { process.exit(1); }
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return release;
}

export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error?.code === "EPERM";
  }
  return !isZombie(pid);
}

function isZombie(pid) {
  const result = runCommand("ps", ["-o", "stat=", "-p", String(pid)], {
    env: { ...process.env, LC_ALL: "C" },
  });
  if (result.status !== 0 || result.signal || result.error) return false;
  return result.stdout.trim().startsWith("Z");
}

export function waitForExit(pids, budgetMs, pollMs = 50) {
  const deadline = Date.now() + budgetMs;
  let alive = [...pids].filter(processAlive);
  while (alive.length > 0 && Date.now() < deadline) {
    sleepSync(pollMs);
    alive = alive.filter(processAlive);
  }
  return new Set(alive);
}

export function readProcessStartTime(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  const result = runCommand("ps", ["-o", "lstart=", "-p", String(pid)], {
    env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
  });
  if (result.status !== 0 || result.signal || result.error) return null;
  return result.stdout.trim() || null;
}
