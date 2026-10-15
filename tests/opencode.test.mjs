import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cliArguments, consumeEvent, DEFAULT_MODEL, parseArgs, resolveBinary, resolveConfig } from '../skills/ask-opencode/scripts/opencode-runner.mjs';
import { preflight } from '../skills/ask-opencode/scripts/opencode-preflight.mjs';
import { listJobs, upsertJob } from '../skills/ask-grok/scripts/lib/state.mjs';
import { buildStatusSnapshot, resolveResultJob, resolveCancelableJob } from '../skills/ask-grok/scripts/lib/job-control.mjs';
import { processAlive } from '../skills/ask-grok/scripts/lib/process.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUNNER = path.join(ROOT, 'skills/ask-opencode/scripts/opencode-runner.mjs');
const JOBS = path.join(ROOT, 'skills/ask-opencode/scripts/opencode-jobs.mjs');
const HOOK = path.join(ROOT, 'scripts/session-lifecycle-hook.mjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { const result = predicate(); if (result) return result; await delay(30); }
  throw new Error('Timed out waiting for fixture');
}
function fixture(t, behavior = 'success') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-test-'));
  const previous = process.env.CODEX_SUITE_DATA;
  process.env.CODEX_SUITE_DATA = path.join(dir, 'state');
  fs.writeFileSync(path.join(dir,'package.json'), '{"type":"module"}');
  const bin = path.join(dir, 'opencode');
  fs.writeFileSync(bin, `#!${process.execPath}\n` + `
import fs from 'node:fs';
import {spawn} from 'node:child_process';
const args = process.argv.slice(2);
const mode = process.env.FAKE_BEHAVIOR;
if(args[0] === '--version') { console.log(mode === 'old' ? 'opencode v1.0.0' : 'opencode v2.0.28'); }
else if(args.includes('--help')) { console.log('--standalone --format --agent --model'); }
else if(args[0] === 'models') { console.log(mode === 'missing-model' ? 'opencode/other-free' : '${DEFAULT_MODEL}'); }
else {
  fs.writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify(args));
  fs.writeFileSync(process.env.FAKE_PID, String(process.pid));
  let prompt='';
  process.stdin.on('data', b => prompt += b);
  process.stdin.on('end', () => {
    fs.writeFileSync(process.env.FAKE_PROMPT, prompt);
    const emit = event => console.log(JSON.stringify(event));
    if(mode === 'hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
    else if(mode === 'tree') {
      const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
      fs.writeFileSync(process.env.FAKE_DESCENDANT, String(child.pid));
      process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);
    }
    else if(mode === 'invalid') { console.log('not JSON'); }
    else if(mode === 'error') { emit({type:'text',sessionID:'ses_mock',part:{text:'partial'}}); emit({type:'error',error:{message:'provider unavailable'}}); }
    else if(mode === 'empty') { emit({type:'step_finish'}); }
    else if(mode === 'exit') { console.error('CLI failed'); process.exitCode=2; }
    else {
      emit({type:'tool_use'});
      const text=Buffer.from(JSON.stringify({type:'text',sessionID:'ses_mock',part:{text:'Answer ✓'}}));
      const index=text.indexOf(Buffer.from('✓'))+1;
      process.stdout.write(text.subarray(0,index));
      setTimeout(()=>process.stdout.write(Buffer.concat([text.subarray(index),Buffer.from('\\n')])),20);
    }
  });
}
`, {mode:0o700});
  const env = {...process.env, CODEX_SUITE_OPENCODE_BIN:bin, FAKE_BEHAVIOR:behavior,
    FAKE_CAPTURE:path.join(dir,'argv'), FAKE_PID:path.join(dir,'pid'), FAKE_PROMPT:path.join(dir,'prompt'), FAKE_DESCENDANT:path.join(dir,'descendant')};
  delete env.CODEX_SUITE_OPENCODE_WORKER;
  const run = (extra = []) => spawnSync(process.execPath,[RUNNER,'--cwd',dir,'--host-session-id','host-a','--prompt-stdin',...extra],{env,input:'inspect only',encoding:'utf8',timeout:12000});
  const jobs = (...args) => spawnSync(process.execPath,[JOBS,...args,'--cwd',dir],{env,encoding:'utf8',timeout:10000});
  t.after(() => {
    // Fixture processes are owned by this test; cleanup only its recorded PIDs.
    for (const file of ['pid','descendant']) {
      try { const pid=Number(fs.readFileSync(path.join(dir,file),'utf8')); if(processAlive(pid)) process.kill(pid,'SIGKILL'); } catch {}
    }
    if(previous === undefined) delete process.env.CODEX_SUITE_DATA; else process.env.CODEX_SUITE_DATA=previous;
    fs.rmSync(dir,{recursive:true,force:true});
  });
  return {dir,env,run,jobs};
}

test('OpenCode defaults to PATH and free model, validates flags and config', t => {
  const f=fixture(t);
  assert.equal(resolveBinary({}), 'opencode');
  assert.equal(resolveBinary({CODEX_SUITE_OPENCODE_BIN:'/custom/cli'}), '/custom/cli');
  assert.equal(resolveConfig(f.dir).model, DEFAULT_MODEL);
  assert.throws(()=>parseArgs(['--mode','bad']), /mode/);
  assert.throws(()=>parseArgs(['--timeout-ms','0']), /positive/);
  assert.throws(()=>parseArgs(['--model','-p/model']), /provider/);
  assert.throws(()=>parseArgs(['--resume','--bad']), /requires/);
  fs.writeFileSync(path.join(f.dir,'.codex-suite.opencode.json'), JSON.stringify({model:'opencode/other-free',timeoutMs:1000,instructions:'protect local changes'}));
  assert.equal(resolveConfig(f.dir).model,'opencode/other-free');
  fs.writeFileSync(path.join(f.dir,'.codex-suite.opencode.json'), '{"unknown":true}');
  assert.throws(()=>resolveConfig(f.dir), /Unknown/);
  for (const mode of ['consult','review','implement']) {
    const args=cliArguments({mode,model:DEFAULT_MODEL,resume:'ses_mock'});
    assert.ok(args.includes('--standalone')); assert.ok(!args.includes('--auto'));
    assert.equal(args[args.indexOf('--agent')+1], mode==='implement'?'build':'explore');
    assert.equal(args[args.indexOf('--session')+1], 'ses_mock');
  }
});

test('OpenCode events preserve output, session, tools, and error', () => {
  const r={rawOutput:'',toolCalls:0};
  consumeEvent({type:'text',sessionID:'ses_test',part:{text:'hello'}},r);
  consumeEvent({type:'tool_use'},r);
  consumeEvent({type:'error',error:{message:'failure'}},r);
  assert.deepEqual(r,{rawOutput:'hello',toolCalls:1,threadId:'ses_test',error:'failure'});
});

test('preflight checks CLI and model without sending a prompt', t => {
  const f=fixture(t);
  assert.equal(preflight(f.dir,f.env).status,'ok');
  assert.equal(fs.existsSync(f.env.FAKE_CAPTURE),false);
  assert.equal(preflight(f.dir,{...f.env,FAKE_BEHAVIOR:'old'}).error_code,'unsupported_version');
  assert.equal(preflight(f.dir,{...f.env,FAKE_BEHAVIOR:'missing-model'}).error_code,'model_not_available');
  assert.equal(preflight(f.dir,{...f.env,FAKE_BEHAVIOR:'missing-model'},'opencode/other-free').status,'ok');
  assert.equal(preflight(f.dir,{...f.env,CODEX_SUITE_OPENCODE_BIN:path.join(f.dir,'absent')}).error_code,'opencode_not_found');
  fs.writeFileSync(path.join(f.dir,'.codex-suite.json'), JSON.stringify({opencode:{model:'opencode/other-free'}}));
  assert.equal(preflight(f.dir,{...f.env,FAKE_BEHAVIOR:'missing-model'}).status,'ok');
});

test('foreground runs record streamed UTF-8 answer and honor CLI overrides', t => {
  const f=fixture(t);
  fs.writeFileSync(path.join(f.dir,'.codex-suite.opencode.json'), JSON.stringify({model:'opencode/legacy-free',instructions:'Legacy constraints'}));
  fs.writeFileSync(path.join(f.dir,'.codex-suite.json'), JSON.stringify({opencode:{model:'opencode/config-free',instructions:'Keep protected files'}}));
  const result=f.run(['--model',DEFAULT_MODEL,'--mode','review','--resume','ses_mock']);
  assert.equal(result.status,0,result.stdout+result.stderr);
  const data=JSON.parse(result.stdout);
  assert.equal(data.rawOutput,'Answer ✓'); assert.equal(data.status,'completed'); assert.equal(data.toolCalls,1);
  const argv=JSON.parse(fs.readFileSync(f.env.FAKE_CAPTURE));
  assert.equal(argv[argv.indexOf('--model')+1],DEFAULT_MODEL);
  assert.match(fs.readFileSync(f.env.FAKE_PROMPT,'utf8'),/Keep protected files/);
  assert.equal(listJobs(f.dir)[0].sessionId,'host-a');
  const stored=JSON.parse(f.jobs('result',data.jobId).stdout).stored;
  assert.equal(stored.rawOutput,'Answer ✓');
});

for (const [behavior,message] of [['invalid',/Invalid OpenCode JSON/],['error',/provider unavailable/],['empty',/no final text/],['exit',/exited 2/],['hang',/timed out/]]) {
  test(`foreground ${behavior} records failure`, t => {
    const f=fixture(t,behavior);
    const result=f.run(['--timeout-ms',behavior==='hang'?'500':'3000']);
    assert.equal(result.status,1,result.stderr);
    assert.match(JSON.parse(result.stdout).error,message);
    assert.equal(listJobs(f.dir)[0].status,'failed');
    if(behavior==='hang') assert.equal(processAlive(Number(fs.readFileSync(f.env.FAKE_PID))),false);
  });
}

test('missing executable leaves a terminal failed job', t => {
  const f=fixture(t); f.env.CODEX_SUITE_OPENCODE_BIN=path.join(f.dir,'absent');
  const result=f.run(); assert.equal(result.status,1);
  assert.equal(listJobs(f.dir)[0].status,'failed');
});

test('background job completes and result is retrievable after launcher exits', async t => {
  const f=fixture(t);
  const result=f.run(['--background']); assert.equal(result.status,0,result.stderr);
  const data=JSON.parse(result.stdout); assert.equal(data.status,'queued');
  await until(()=>listJobs(f.dir).find(j=>j.id===data.jobId)?.status==='completed');
  const retrieved=f.jobs('result',data.jobId); assert.equal(retrieved.status,0,retrieved.stderr);
  assert.equal(JSON.parse(retrieved.stdout).stored.rawOutput,'Answer ✓');
});

test('background cancellation kills resistant CLI and descendant and preserves cancelled status', async t => {
  const f=fixture(t,'tree'); const result=f.run(['--background']);
  assert.equal(result.status,0,result.stderr); const data=JSON.parse(result.stdout);
  await until(()=>fs.existsSync(f.env.FAKE_DESCENDANT));
  const pid=Number(fs.readFileSync(f.env.FAKE_PID)); const descendant=Number(fs.readFileSync(f.env.FAKE_DESCENDANT));
  const early=f.jobs('result',data.jobId); assert.equal(early.status,1); assert.match(early.stderr,/opencode-status/);
  const cancelled=f.jobs('cancel',data.jobId); assert.equal(cancelled.status,0,cancelled.stderr);
  if (!listJobs(f.dir)[0].pidStartedAt) {
    assert.equal(JSON.parse(cancelled.stdout).outcome,'unverifiable');
    assert.equal(JSON.parse(cancelled.stdout).terminated,false);
    assert.equal(listJobs(f.dir)[0].terminationConfirmed,false);
    return;
  }
  assert.equal(JSON.parse(cancelled.stdout).terminated,true,cancelled.stdout);
  await until(()=>!processAlive(pid) && !processAlive(descendant));
  await delay(100);
  assert.equal(listJobs(f.dir)[0].status,'cancelled');
  assert.equal(listJobs(f.dir)[0].terminationConfirmed,true);
});

test('controllers isolate backends and sessions including explicit references', t => {
  const f=fixture(t);
  for (const [id,backend,sessionId,status] of [['grok-a',undefined,'host-a','running'],['opencode-a','opencode','host-a','completed'],['opencode-b','opencode','host-b','running']]) upsertJob(f.dir,{id,backend,sessionId,status});
  assert.deepEqual(buildStatusSnapshot(f.dir,{sessionId:'host-a'}).running.map(j=>j.id),['grok-a']);
  const snapshot=buildStatusSnapshot(f.dir,{backend:'opencode',sessionId:'host-a'});
  assert.equal(snapshot.running.length,0); assert.equal(snapshot.latestFinished.id,'opencode-a');
  assert.throws(()=>resolveResultJob(f.dir,'grok-a',{backend:'opencode'}),/No job/);
  assert.throws(()=>resolveResultJob(f.dir,'opencode-a'),/No job/);
  assert.throws(()=>resolveCancelableJob(f.dir,undefined,{backend:'opencode',sessionId:'host-a'}),/No active OpenCode/);
  assert.equal(resolveCancelableJob(f.dir,'opencode-b',{backend:'opencode',sessionId:'host-a'}).job.id,'opencode-b');
  assert.equal(JSON.parse(f.jobs('status','--all').stdout).running[0].id,'opencode-b');
  assert.equal(f.jobs('status','--bogus').status,1);
});

test('SessionEnd cleans up OpenCode jobs only from the ending session', async t => {
  const f=fixture(t,'hang'); const result=f.run(['--background']); assert.equal(result.status,0);
  await until(()=>fs.existsSync(f.env.FAKE_PID));
  upsertJob(f.dir,{id:'other-session',backend:'opencode',sessionId:'host-b',status:'completed'});
  const cleanup=spawnSync(process.execPath,[HOOK,'SessionEnd'],{cwd:f.dir,env:f.env,encoding:'utf8',input:JSON.stringify({session_id:'host-a',cwd:f.dir}),timeout:10000});
  assert.equal(cleanup.status,0,cleanup.stderr);
  const retained=listJobs(f.dir).find(j=>j.sessionId==='host-a');
  if (retained && !retained.pidStartedAt) {
    assert.equal(retained.status,'cancelled');
    assert.equal(retained.terminationConfirmed,false);
    assert.match(retained.errorMessage,/identity could not be proven/);
    return;
  }
  assert.deepEqual(listJobs(f.dir).map(j=>j.id),['other-session'],JSON.stringify(listJobs(f.dir)));
  assert.equal(processAlive(Number(fs.readFileSync(f.env.FAKE_PID))),false);
});

test('background timeout records a terminal failure and stops the CLI', async t => {
  const f=fixture(t,'hang');
  const queued=f.run(['--background','--timeout-ms','500']); assert.equal(queued.status,0,queued.stderr);
  const id=JSON.parse(queued.stdout).jobId;
  await until(()=>listJobs(f.dir).find(j=>j.id===id)?.status==='failed');
  const result=f.jobs('result',id); assert.equal(result.status,0,result.stderr);
  assert.match(JSON.parse(result.stdout).stored.error,/timed out/);
  assert.equal(processAlive(Number(fs.readFileSync(f.env.FAKE_PID))),false);
});

test('background missing executable replaces saved request with a failed result', async t => {
  const f=fixture(t); f.env.CODEX_SUITE_OPENCODE_BIN=path.join(f.dir,'absent');
  const queued=f.run(['--background']); assert.equal(queued.status,0,queued.stderr);
  const id=JSON.parse(queued.stdout).jobId;
  await until(()=>listJobs(f.dir).find(j=>j.id===id)?.status==='failed');
  const result=JSON.parse(f.jobs('result',id).stdout).stored;
  assert.equal(result.status,'failed'); assert.match(result.error,/ENOENT/); assert.equal(result.request,undefined);
});

test('OpenCode runner uses unified model selection without an explicit override', t => {
  const f=fixture(t);
  fs.writeFileSync(path.join(f.dir,'.codex-suite.json'),JSON.stringify({grok:{model:'grok-pin'},opencode:{model:'opencode/unified-free',instructions:'Unified runner constraints'}}));
  const result=f.run(); assert.equal(result.status,0,result.stdout+result.stderr);
  const argv=JSON.parse(fs.readFileSync(f.env.FAKE_CAPTURE));
  assert.equal(argv[argv.indexOf('--model')+1],'opencode/unified-free');
  assert.match(fs.readFileSync(f.env.FAKE_PROMPT,'utf8'),/Unified runner constraints/);
});
