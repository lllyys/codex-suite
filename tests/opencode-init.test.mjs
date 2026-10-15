import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseArgs, runInit } from '../skills/opencode-init/scripts/init-config.mjs';
import { DEFAULT_MODEL, resolveConfig } from '../skills/ask-opencode/scripts/opencode-runner.mjs';

const SCRIPT = fileURLToPath(new URL('../skills/opencode-init/scripts/init-config.mjs', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-init-'));
  fs.mkdirSync(path.join(root,'src'));
  fs.writeFileSync(path.join(root,'package.json'), JSON.stringify({scripts:{test:'node --test'}}));
  fs.writeFileSync(path.join(root,'pnpm-lock.yaml'), 'lockfileVersion: 9');
  fs.writeFileSync(path.join(root,'.codex-suite.md'), 'Grok user settings\n');
  fs.writeFileSync(path.join(root,'opencode.json'), '{"model":"user/native-model"}\n');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const run = args => spawnSync(process.execPath,[SCRIPT,'--cwd',root,...args],{encoding:'utf8',env:{...process.env,CODEX_SUITE_OPENCODE_BIN:path.join(root,'no-cli')}});
  return {root,run,file:path.join(root,'.codex-suite.json'),legacy:path.join(root,'.codex-suite.opencode.json')};
}

test('OpenCode init creates runner-readable free defaults and detects project instructions offline', t => {
  const f=fixture(t);
  const result=f.run(['--defaults']); assert.equal(result.status,0,result.stdout+result.stderr);
  const parsed=JSON.parse(result.stdout);
  assert.equal(parsed.status,'created'); assert.equal(parsed.testCommand,'pnpm test');
  const config=resolveConfig(f.root);
  assert.equal(config.model,DEFAULT_MODEL); assert.equal(config.timeoutMs,900000);
  assert.match(config.instructions,/Node.js/); assert.match(config.instructions,/src\//); assert.match(config.instructions,/pnpm test/);
  assert.deepEqual(config,parsed.selected);
  assert.equal(fs.readFileSync(path.join(f.root,'.codex-suite.md'),'utf8'),'Grok user settings\n');
  assert.equal(fs.readFileSync(path.join(f.root,'opencode.json'),'utf8'),'{"model":"user/native-model"}\n');
});

test('OpenCode init preserves existing bytes even with defaults or overrides', t => {
  const f=fixture(t); const original='{"opencode":{"model":"opencode/custom-free"}}\n'; fs.writeFileSync(f.file,original);
  const result=f.run(['--defaults','--model',DEFAULT_MODEL]);
  assert.equal(result.status,2); assert.equal(JSON.parse(result.stdout).status,'exists');
  assert.equal(fs.readFileSync(f.file,'utf8'),original);
  assert.equal(runInit({cwd:f.root,inspect:true}).exists,true);
});

test('explicit force replaces malformed config with validated overrides', t => {
  const f=fixture(t); fs.writeFileSync(f.legacy,'broken JSON');
  assert.equal(runInit({cwd:f.root,inspect:true}).status,'ok');
  const result=f.run(['--force','--model','opencode/other-free','--timeout-ms','120000','--instructions','Keep custom constraints']);
  assert.equal(result.status,0,result.stdout);
  assert.equal(JSON.parse(result.stdout).status,'regenerated');
  assert.deepEqual(resolveConfig(f.root),{model:'opencode/other-free',timeoutMs:120000,instructions:'Keep custom constraints'});
});

test('dry-run and inspect never write project settings', t => {
  const f=fixture(t);
  assert.equal(runInit({cwd:f.root,inspect:true}).exists,false);
  const preview=runInit({cwd:f.root,dryRun:true});
  assert.equal(preview.status,'dry-run'); assert.deepEqual(JSON.parse(preview.content).opencode,preview.selected);
  assert.equal(fs.existsSync(f.file),false);
  fs.writeFileSync(f.legacy,'existing invalid text');
  const replacement=runInit({cwd:f.root,dryRun:true,force:true});
  assert.equal(replacement.status,'dry-run');
  assert.equal(fs.readFileSync(f.legacy,'utf8'),'existing invalid text');
});

test('initializer resolves nested Git workspace and instruction file relative to invocation directory', t => {
  const f=fixture(t);
  const git=spawnSync('git',['init','--quiet',f.root],{encoding:'utf8'}); assert.equal(git.status,0,git.stderr);
  const nested=path.join(f.root,'src'); const instructions='Protect fixtures.\nTest changed behavior.\n';
  fs.writeFileSync(path.join(nested,'instructions.txt'),instructions);
  const result=runInit({cwd:nested,instructionsFile:'instructions.txt'});
  assert.equal(fs.realpathSync(result.configPath),fs.realpathSync(f.file));
  assert.equal(resolveConfig(f.root).instructions,instructions);
  assert.equal(fs.existsSync(path.join(nested,'.codex-suite.json')),false);
});

test('invalid flags and values fail before creating config', t => {
  const f=fixture(t);
  for (const args of [['--model'],['--timeout-ms'],['--model','invalid'],['--timeout-ms','0'],['--timeout-ms','NaN'],['--timeout-ms','1.5'],['--bad'],['--instructions','one','--instructions-file','two']]) {
    const result=f.run(args); assert.equal(result.status,1,JSON.stringify(args)+result.stdout);
    assert.equal(JSON.parse(result.stdout).status,'error'); assert.equal(fs.existsSync(f.file),false);
  }
  assert.throws(()=>parseArgs(['--cwd','--defaults']),/requires a value/);
});

test('initializer preserves existing symbolic links unless replacement is explicit', t => {
  const f=fixture(t); const target=path.join(f.root,'user-settings');
  fs.writeFileSync(target,'private user settings'); fs.symlinkSync(target,f.legacy);
  assert.equal(runInit({cwd:f.root}).status,'exists');
  runInit({cwd:f.root,force:true});
  assert.equal(fs.readFileSync(target,'utf8'),'private user settings');
  assert.equal(fs.lstatSync(f.legacy).isSymbolicLink(),true);
  assert.equal(resolveConfig(f.root).model,DEFAULT_MODEL);
  assert.equal(fs.readdirSync(f.root).some(name=>name.includes('.tmp-')),false);
});
