#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs, resolveBinary, resolveConfig } from './opencode-runner.mjs';
import { resolveWorkspaceRoot } from '../../ask-grok/scripts/lib/workspace.mjs';

export function preflight(cwd = process.cwd(), env = process.env, model = null) {
  const config = resolveConfig(resolveWorkspaceRoot(cwd));
  if (model !== null) config.model = parseArgs(['--model', model]).model;
  const binary = resolveBinary(env);
  const result = { backend:'opencode', preflight_schema:1, status:'error', binary,
    default_model:config.model, models:[], auth_mode:'provider-managed',
    model_request_sent:false };
  const run = args => spawnSync(binary, args, {cwd, env, encoding:'utf8', timeout:30000, maxBuffer:4*1024*1024});
  const version = run(['--version']);
  if (version.error || version.status !== 0) return {...result, error_code:version.error?.code === 'ENOENT' ? 'opencode_not_found' : 'opencode_unavailable', error:'OpenCode version check failed; check PATH and CLI log-directory permissions.'};
  result.opencode_version = version.stdout.trim() || version.stderr.trim();
  if (!/\bv?2\./.test(result.opencode_version)) return {...result, error_code:'unsupported_version', error:'OpenCode 2 is required.'};
  const help = run(['run', '--help']);
  if (help.error || help.status !== 0 || !['--standalone','--format','--agent','--model'].every(flag => help.stdout.includes(flag))) return {...result, error_code:'unsupported_cli', error:'OpenCode must support run --standalone --format json --agent --model.'};
  const models = run(['models', '--standalone']);
  if (models.error || models.status !== 0) return {...result, error_code:'model_discovery_failed', error:'OpenCode model discovery failed; check connectivity and provider configuration.'};
  result.models = [...new Set(models.stdout.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '').split(/\r?\n/).map(line => line.trim()).filter(line => /^[^\s/]+\/[^\s]+$/.test(line)))];
  if (!result.models.includes(config.model.split('#')[0])) return {...result, error_code:'model_not_available', error:'Configured model is not listed. Choose an available free model explicitly; no paid fallback is selected.'};
  return {...result, status:'ok'};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    for (let i=0; i<argv.length; i+=2) {
      if (!['--cwd','--model'].includes(argv[i]) || !argv[i+1]) throw new Error('usage: opencode-preflight.mjs [--cwd <path>] [--model <provider/model>]');
    }
    const args = parseArgs(argv);
    const result = preflight(path.resolve(args.cwd), process.env, args.model ?? null);
    console.log(JSON.stringify(result));
    if (result.status !== 'ok') process.exitCode = 1;
  } catch (error) { console.log(JSON.stringify({backend:'opencode',status:'error',error:error.message})); process.exitCode=1; }
}
