import { spawn } from 'node:child_process';

const SCRIPT = `on run argv
  set jobId to item 1 of argv
  set jobStatus to item 2 of argv
  display notification (jobId & " · " & jobStatus) with title "Codex Suite"
end run`;

// Best effort: process success means the OS accepted the request, not that
// notification settings allowed a visible banner. Never pass task contents.
export async function notifyCompletion(jobId, status, options = {}) {
  if ((options.platform ?? process.platform) !== 'darwin'
      || !/^opencode-[A-Za-z0-9-]+$/.test(jobId)
      || !['completed', 'failed'].includes(status)) return false;
  try {
    return await new Promise(resolve => {
      const child = (options.spawnImpl ?? spawn)('/usr/bin/osascript', ['-e', SCRIPT, jobId, status], { stdio: 'ignore' });
      let timer;
      const finish = accepted => { clearTimeout(timer); resolve(accepted); };
      child.once('error', () => finish(false));
      child.once('close', code => finish(code === 0));
      timer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish(false);
      }, options.timeoutMs ?? 2000);
    });
  } catch { return false; }
}
