import { spawnSync } from "node:child_process";
import path from "node:path";

export function resolveWorkspaceRoot(candidate = process.cwd()) {
  const cwd = path.resolve(candidate);
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : cwd;
}
