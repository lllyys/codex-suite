#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OPENCODE_MODEL, readUnifiedConfig, validateBackend } from '../../ask-grok/scripts/lib/project-config.mjs';
import { resolveWorkspaceRoot } from '../../ask-grok/scripts/lib/workspace.mjs';
import { generateJobId, createJobLogFile, upsertJob, claimJob, writeJobFile, readJobFile, resolveJobFile } from '../../ask-grok/scripts/lib/state.mjs';
import { readProcessStartTime, terminateProcessTree } from '../../ask-grok/scripts/lib/process.mjs';

export const DEFAULT_MODEL = DEFAULT_OPENCODE_MODEL;
const MODEL_ID = /^[^\s/\x00-\x1f-][^\s/\x00-\x1f]*\/[^\s\x00-\x1f]+$/;
export function resolveBinary(env = process.env) {
  return env.CODEX_SUITE_OPENCODE_BIN || 'opencode';
}
export function resolveConfig(cwd) {
  cwd = resolveWorkspaceRoot(cwd);
  const unified = readUnifiedConfig(cwd).config;
  if (unified && Object.hasOwn(unified, 'opencode')) return validateConfig(unified.opencode);
  const file = path.join(cwd, '.codex-suite.opencode.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return validateConfig(config);
}
export function validateConfig(config) {
  validateBackend('opencode', config);
  return { model: DEFAULT_MODEL, timeoutMs: 900000, instructions: '', ...config };
}
export function parseArgs(argv) {
  const args = { mode: 'consult', cwd: process.cwd(), background: false, summary: 'OpenCode task' };
  const values = { '--cwd':'cwd', '--model':'model', '--mode':'mode', '--resume':'resume', '--timeout-ms':'timeoutMs', '--summary':'summary', '--host-session-id':'sessionId', '--state-data':'stateData' };
  for (let i=0; i<argv.length; i++) {
    const flag = argv[i];
    if (flag === '--prompt-stdin') args.promptStdin = true;
    else if (flag === '--background') args.background = true;
    else if (flag === '--wait') args.background = false;
    else if (values[flag]) {
      if (!argv[i+1] || argv[i+1].startsWith('--')) throw new Error(`${flag} requires a value`);
      args[values[flag]] = argv[++i];
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!['consult','implement','review'].includes(args.mode)) throw new Error('mode must be consult, implement, or review');
  if (args.timeoutMs !== undefined) {
    args.timeoutMs = Number(args.timeoutMs);
    if (!Number.isSafeInteger(args.timeoutMs) || args.timeoutMs < 1) throw new Error('timeout-ms must be a positive integer');
  }
  if (args.model !== undefined && !MODEL_ID.test(args.model)) throw new Error('model must be provider/model');
  if (args.resume && !/^ses_[A-Za-z0-9]+$/.test(args.resume)) throw new Error('resume must be an OpenCode session ID');
  return args;
}
export function consumeEvent(event, result) {
  if (!event || typeof event !== 'object') throw new Error('Invalid OpenCode event');
  if (event.sessionID) result.threadId = event.sessionID;
  if (event.type === 'text' && typeof event.part?.text === 'string') result.rawOutput += event.part.text;
  if (event.type === 'error') result.error = event.error?.message || JSON.stringify(event.error || event);
  if (event.type === 'tool_use') result.toolCalls++;
}
export function cliArguments(args) {
  const argv = ['run', '--standalone', '--format', 'json', '--agent', args.mode === 'implement' ? 'build' : 'explore', '--model', args.model];
  if (args.resume) argv.push('--session', args.resume);
  // Never auto-approve permissions in the initial integration.
  return argv;
}
async function execute(args, id, logFile) {
  const result = { status:'failed', rawOutput:'', threadId:null, toolCalls:0 };
  const bin = resolveBinary();
  const boundary = `You are an OpenCode worker delegated by Codex Suite. Complete this task yourself. Do not delegate back to Codex, Claude, Grok, or another coding agent. Do not commit, push, publish, or change unrelated files. Preserve existing user changes. ${args.mode === 'implement' ? 'Implement within the requested workspace and report changes and validation.' : 'Inspect and answer without changing files or running mutation commands.'}\n`;
  const child = spawn(bin, cliArguments(args), { cwd:args.cwd, detached:process.platform !== 'win32', stdio:['pipe','pipe','pipe'] });
  const decoder = new StringDecoder('utf8');
  let buffer='', stderr='', bytes=0, failure=null, killTimer, interrupted;
  const stop = (message) => {
    failure ||= message;
    try { terminateProcessTree(child.pid); } catch {}
    killTimer ||= setTimeout(() => {
      try { terminateProcessTree(child.pid, {signal:'SIGKILL'}); } catch {}
    }, 1000);
  };
  // Keep the worker alive until the standalone CLI group exits, including
  // forced termination, so the controller can confirm cancellation reliably.
  const handlers = new Map(['SIGINT','SIGTERM','SIGHUP'].map(signal => [signal, () => {
    interrupted ||= signal;
    stop('OpenCode task interrupted');
  }]));
  for (const [signal, handler] of handlers) process.on(signal, handler);
  const timer = setTimeout(() => stop('OpenCode task timed out'), args.timeoutMs);
  const parseLine = line => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      consumeEvent(event, result);
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${event.type || 'event'}\n`);
    } catch (error) { stop(`Invalid OpenCode JSON output: ${error.message}`); }
  };
  child.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024) { stop('OpenCode output exceeded 16 MiB'); return; }
    buffer += decoder.write(chunk);
    let newline;
    while ((newline=buffer.indexOf('\n'))>=0) { parseLine(buffer.slice(0,newline)); buffer=buffer.slice(newline+1); }
  });
  child.stderr.on('data', chunk => { stderr=(stderr+chunk.toString()).slice(-8192); });
  child.stdin.on('error', () => {});
  child.stdin.end(`${boundary}\n${args.instructions}\n\n${args.prompt}`);
  await new Promise(resolve => {
    child.on('error', error => { failure=error.message; resolve(); });
    child.on('close', (code, signal) => {
      buffer += decoder.end();
      if (buffer.trim()) parseLine(buffer);
      if (code !== 0) failure ||= `OpenCode exited ${code ?? signal}: ${stderr.trim()}`;
      resolve();
    });
  });
  clearTimeout(timer); clearTimeout(killTimer);
  if (failure) {
    try { terminateProcessTree(child.pid, {signal:'SIGKILL'}); } catch {}
  }
  for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  if (interrupted) {
    // The CLI leader may exit before a descendant; clear its group as well.
    try { terminateProcessTree(child.pid, {signal:'SIGKILL'}); } catch {}
    process.kill(process.pid, interrupted);
    return;
  }
  result.error = failure || result.error || (!result.rawOutput.trim() ? 'OpenCode returned no final text' : null);
  result.status = result.error ? 'failed' : 'completed';
  const finalized = claimJob(args.cwd, id, {status:result.status, phase:result.status, threadId:result.threadId, completedAt:new Date().toISOString(), ...(result.error ? {errorMessage:result.error}: {})});
  if (finalized) writeJobFile(args.cwd, id, result);
  return { jobId:id, ...result };
}
async function main() {
  let args = parseArgs(process.argv.slice(2));
  if (args.stateData) process.env.CODEX_SUITE_DATA=path.resolve(args.stateData);
  args.cwd=resolveWorkspaceRoot(path.resolve(args.cwd));
  if (!fs.statSync(args.cwd).isDirectory()) throw new Error('Workspace must be a directory');
  const workerId=process.env.CODEX_SUITE_OPENCODE_WORKER;
  if (workerId) {
    const stored=readJobFile(resolveJobFile(args.cwd, workerId));
    args={...stored.request, cwd:args.cwd};
    if (!claimJob(args.cwd, workerId, {status:'running', phase:'running', pid:process.pid, pidStartedAt:readProcessStartTime(process.pid), startedAt:new Date().toISOString()})) return;
    await execute(args,workerId,stored.logFile);
    return;
  }
  args={...resolveConfig(args.cwd), ...args};
  args.sessionId ||= process.env.CODEX_SUITE_SESSION_ID || null;
  if (!args.promptStdin) throw new Error('Use --prompt-stdin to provide the task');
  args.prompt=fs.readFileSync(0,'utf8');
  if (!args.prompt.trim()) throw new Error('Prompt must not be empty');
  if (Buffer.byteLength(args.prompt)>1024*1024) throw new Error('Prompt exceeds 1 MiB');
  const id=generateJobId('opencode');
  const logFile=createJobLogFile(args.cwd,id);
  upsertJob(args.cwd,{id,backend:'opencode',kind:`opencode-${args.mode}`,summary:args.summary,sessionId:args.sessionId,model:args.model,status:args.background?'queued':'running',phase:'spawn',logFile,pid:args.background?null:process.pid,pidStartedAt:args.background?null:readProcessStartTime(process.pid),startedAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+args.timeoutMs).toISOString()});
  try {
  if (args.background) {
    writeJobFile(args.cwd,id,{request:args,logFile});
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--cwd',args.cwd],{cwd:args.cwd,detached:true,stdio:'ignore',env:{...process.env,CODEX_SUITE_OPENCODE_WORKER:id}});
    await new Promise((resolve,reject)=>{ child.once('spawn',resolve); child.once('error',reject); });
    const pidStartedAt=readProcessStartTime(child.pid);
    claimJob(args.cwd,id,{pid:child.pid,...(pidStartedAt ? {pidStartedAt}: {})});
    child.unref();
    console.log(JSON.stringify({jobId:id,status:'queued'}));
  } else {
    const result=await execute(args,id,logFile);
    console.log(JSON.stringify(result));
    if (result.status!=='completed') process.exitCode=1;
  }
  } catch (error) {
    claimJob(args.cwd, id, {status:'failed', phase:'failed', errorMessage:error.message, completedAt:new Date().toISOString()});
    writeJobFile(args.cwd, id, {status:'failed', error:error.message, rawOutput:''});
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{
  const id=process.env.CODEX_SUITE_OPENCODE_WORKER;
  if (id) {
    try {
      const cwd=resolveWorkspaceRoot(process.cwd());
      if (claimJob(cwd,id,{status:'failed',phase:'failed',errorMessage:error.message,completedAt:new Date().toISOString()})) {
        writeJobFile(cwd,id,{status:'failed',error:error.message,rawOutput:''});
      }
    } catch {}
  }
  console.log(JSON.stringify({status:'failed',error:error.message})); process.exitCode=1;
});
