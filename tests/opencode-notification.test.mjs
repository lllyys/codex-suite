import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { notifyCompletion } from '../skills/ask-opencode/scripts/completion-notification.mjs';
import { finalizeJob, parseArgs } from '../skills/ask-opencode/scripts/opencode-runner.mjs';
import { listJobs, readJobFile, resolveJobFile, upsertJob } from '../skills/ask-grok/scripts/lib/state.mjs';

test('desktop notification requires explicit background opt-in', () => {
  assert.equal(parseArgs(['--background', '--notify']).notify, true);
  assert.equal(parseArgs(['--background']).notify, undefined);
  assert.throws(() => parseArgs(['--notify']), /requires --background/);
  assert.throws(() => parseArgs(['--background', '--notify', '--wait']), /requires --background/);
});

test('macOS notification uses a fixed script and separate job/status arguments', async () => {
  let captured;
  const accepted = await notifyCompletion('opencode-test-123', 'completed', {
    platform: 'darwin',
    spawnImpl(command, args, options) {
      captured = { command, args, options };
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    },
  });
  assert.equal(accepted, true);
  assert.equal(captured.command, '/usr/bin/osascript');
  assert.equal(captured.args[0], '-e');
  assert.deepEqual(captured.args.slice(2), ['opencode-test-123', 'completed']);
  assert.ok(!captured.args[1].includes('opencode-test-123'));
  assert.equal(captured.options.stdio, 'ignore');
  assert.equal(captured.options.shell, undefined);
});

test('unsupported platforms, unsafe IDs, and nonterminal states never spawn', async () => {
  let calls = 0;
  const spawnImpl = () => { calls++; throw new Error('must not spawn'); };
  for (const [platform, id, status] of [
    ['linux', 'opencode-test', 'completed'],
    ['darwin', 'opencode-test\nprivate prompt', 'completed'],
    ['darwin', 'opencode-test', 'running'],
    ['darwin', 'opencode-test', 'cancelled'],
  ]) assert.equal(await notifyCompletion(id, status, { platform, spawnImpl }), false);
  assert.equal(calls, 0);
});

test('notification launch errors, rejection and timeout are harmless', async () => {
  for (const behavior of ['throw', 'error', 'reject', 'hang']) {
    let killed = false;
    const accepted = await notifyCompletion('opencode-test', 'failed', {
      platform: 'darwin', timeoutMs: 10,
      spawnImpl() {
        if (behavior === 'throw') throw new Error('missing notifier');
        const child = new EventEmitter();
        child.kill = () => { killed = true; };
        queueMicrotask(() => {
          if (behavior === 'error') child.emit('error', new Error('OS unavailable'));
          if (behavior === 'reject') child.emit('close', 1);
        });
        return child;
      },
    });
    assert.equal(accepted, false, behavior);
    assert.equal(killed, behavior === 'hang', behavior);
  }
});

test('terminal result is persisted before opt-in notification; failure never changes outcome', async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-notify-'));
  const previous = process.env.CODEX_SUITE_DATA;
  process.env.CODEX_SUITE_DATA = path.join(cwd, 'state');
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_SUITE_DATA;
    else process.env.CODEX_SUITE_DATA = previous;
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const cases = [
    { id: 'opencode-optin', background: true, notify: true, initial: 'running', expected: 1 },
    { id: 'opencode-failed', background: true, notify: true, initial: 'running', expected: 1, failed: true },
    { id: 'opencode-default', background: true, initial: 'running', expected: 0 },
    { id: 'opencode-foreground', background: false, initial: 'running', expected: 0 },
    { id: 'opencode-cancelled', background: true, notify: true, initial: 'cancelled', expected: 0 },
  ];
  for (const item of cases) {
    const result = item.failed
      ? { status: 'failed', rawOutput: 'partial private result', error: 'provider failed' }
      : { status: 'completed', rawOutput: 'private task result', error: null };
    upsertJob(cwd, { id: item.id, backend: 'opencode', sessionId: 'host-test', status: item.initial });
    let calls = 0;
    let observed;
    await finalizeJob({ ...item, cwd }, item.id, result, async (...args) => {
      calls++;
      observed = { args, result: readJobFile(resolveJobFile(cwd, item.id)), status: listJobs(cwd).find(j => j.id === item.id).status };
      throw new Error('notification unavailable');
    });
    assert.equal(calls, item.expected);
    if (calls) {
      assert.deepEqual(observed.args, [item.id, result.status]);
      assert.deepEqual(observed.result, result);
      assert.equal(observed.status, result.status);
    }
    const storedJob = listJobs(cwd).find(j => j.id === item.id);
    assert.equal(storedJob.status, item.initial === 'cancelled' ? 'cancelled' : result.status);
    assert.equal(storedJob.sessionId, 'host-test');
  }
});
