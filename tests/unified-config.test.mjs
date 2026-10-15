import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { loadProjectConfig, buildDelegatedPrompt } from '../skills/ask-grok/scripts/lib/config.mjs';
import { resolveConfig, DEFAULT_MODEL } from '../skills/ask-opencode/scripts/opencode-runner.mjs';
import { runInit as grokInit } from '../skills/codex-suite-init/scripts/init-config.mjs';
import { runInit as opencodeInit } from '../skills/opencode-init/scripts/init-config.mjs';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const GROK=path.join(ROOT,'skills/grok-init/scripts/init-config.mjs');
const ALIAS=path.join(ROOT,'skills/codex-suite-init/scripts/init-config.mjs');
const OPENCODE=path.join(ROOT,'skills/opencode-init/scripts/init-config.mjs');
const legacyGrok='## Defaults\n- **Default model**: old-grok\n- **Default effort**: xhigh\n- **Default audit type**: full\n- **Default sandbox**: read-only\n\n## Audit Focus\n```text\nPrioritize auth bugs.\n```\n## Skip Patterns\n```text\nvendor/\n*.min.js\n```\n## Project-Specific Instructions\n```text\nPreserve our APIs.\n```\n';
const legacyOpenCode={model:'opencode/custom-free',timeoutMs:12345,instructions:'Protect fixtures.'};
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'suite-unified-'));
  const file=path.join(root,'.codex-suite.json');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,file,write:data=>fs.writeFileSync(file,JSON.stringify(data)),read:()=>JSON.parse(fs.readFileSync(file,'utf8')),
    legacy() {
      fs.writeFileSync(path.join(root,'.codex-suite.md'),legacyGrok);
      fs.writeFileSync(path.join(root,'.codex-suite.opencode.json'),JSON.stringify(legacyOpenCode));
    }};
}
function runAsync(script,root,extra=[]) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,'--cwd',root,...extra],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr=''; child.stdout.on('data',data=>stdout+=data); child.stderr.on('data',data=>stderr+=data);
    child.on('error',reject); child.on('close',status=>resolve({status,stdout,stderr}));
  });
}

test('unified sections override legacy independently and inject Grok prompt context',t=>{
  const f=fixture(t); f.legacy();
  f.write({grok:{model:'new-grok',effort:'high',auditType:'mini',sandbox:'workspace-write',focusInstructions:'Inspect concurrency.',skipPatterns:['generated/'],instructions:'Use the new API.'},opencode:{model:DEFAULT_MODEL,timeoutMs:5000,instructions:'Use unified constraints.'}});
  const grok=loadProjectConfig(f.root);
  assert.equal(grok.defaultModel,'new-grok'); assert.equal(grok.defaultEffort,'high'); assert.equal(grok.defaultAuditType,'mini');
  assert.equal(grok.defaultSandbox,'workspace-write'); assert.deepEqual(grok.skipPatterns,['generated/']);
  assert.equal(grok.configFile,f.file);
  const prompt=buildDelegatedPrompt(f.root,'audit','Review','BOUNDARY');
  assert.match(prompt,/\.codex-suite\.json/); assert.match(prompt,/Inspect concurrency/); assert.match(prompt,/Use the new API/);
  assert.doesNotMatch(prompt,/Protect fixtures|Preserve our APIs|Prioritize auth/);
  assert.deepEqual(resolveConfig(f.root),{model:DEFAULT_MODEL,timeoutMs:5000,instructions:'Use unified constraints.'});
});

test('missing backend section falls back to legacy but empty section uses defaults',t=>{
  const f=fixture(t); f.legacy(); f.write({grok:{}});
  assert.equal(loadProjectConfig(f.root).defaultModel,null); assert.deepEqual(loadProjectConfig(f.root).skipPatterns,[]);
  assert.deepEqual(resolveConfig(f.root),legacyOpenCode);
  f.write({opencode:{}});
  assert.equal(loadProjectConfig(f.root).defaultModel,'old-grok');
  assert.deepEqual(resolveConfig(f.root),{model:DEFAULT_MODEL,timeoutMs:900000,instructions:''});
});

test('initialization and forced regeneration preserve the other unified section',t=>{
  const f=fixture(t); const original={model:'keep-grok',effort:'xhigh',skipPatterns:['private/'],instructions:'Keep me'};
  f.write({grok:original}); assert.equal(opencodeInit({cwd:f.root}).status,'created');
  assert.deepEqual(f.read().grok,original);
  assert.equal(opencodeInit({cwd:f.root,force:true,timeoutMs:1111}).status,'regenerated');
  assert.deepEqual(f.read().grok,original); const open=f.read().opencode;
  assert.equal(grokInit({cwd:f.root,force:true,model:'replacement'}).status,'regenerated');
  assert.deepEqual(f.read().opencode,open); assert.equal(f.read().grok.model,'replacement');
  assert.equal(grokInit({cwd:f.root}).status,'exists');
});

test('migration preserves all supported legacy settings and source bytes',t=>{
  const f=fixture(t); f.legacy();
  const old=loadProjectConfig(f.root);
  const preview=grokInit({cwd:f.root,migrate:true,dryRun:true});
  assert.equal(preview.status,'dry-run'); assert.equal(fs.existsSync(f.file),false);
  assert.equal(grokInit({cwd:f.root,migrate:true}).status,'migrated');
  assert.equal(opencodeInit({cwd:f.root,migrate:true}).status,'migrated');
  const migrated=loadProjectConfig(f.root);
  for(const key of ['defaultModel','defaultEffort','defaultAuditType','defaultSandbox','focusInstructions','skipPatterns','projectInstructions']) assert.deepEqual(migrated[key],old[key],key);
  assert.deepEqual(resolveConfig(f.root),legacyOpenCode);
  assert.equal(fs.readFileSync(path.join(f.root,'.codex-suite.md'),'utf8'),legacyGrok);
  assert.equal(fs.readFileSync(path.join(f.root,'.codex-suite.opencode.json'),'utf8'),JSON.stringify(legacyOpenCode));
  const before=fs.readFileSync(f.file,'utf8');
  assert.equal(grokInit({cwd:f.root,migrate:true}).status,'exists');
  assert.equal(fs.readFileSync(f.file,'utf8'),before);
});

test('migration cannot silently apply overrides or reset settings',t=>{
  const f=fixture(t); f.legacy();
  assert.throws(()=>grokInit({cwd:f.root,migrate:true,force:true}),/migrate|force/);
  assert.throws(()=>grokInit({cwd:f.root,migrate:true,effort:'high'}),/unchanged/);
  assert.throws(()=>opencodeInit({cwd:f.root,migrate:true,model:DEFAULT_MODEL}),/unchanged/);
  assert.throws(()=>opencodeInit({cwd:f.root,migrate:true,defaults:true}),/unchanged/);
  assert.equal(fs.existsSync(f.file),false);
});

test('Grok initializer rejects a model with embedded newlines before writing',t=>{
  const f=fixture(t);
  assert.throws(()=>grokInit({cwd:f.root,model:'test-model\nignored-value'}),/model slug/);
  assert.equal(fs.existsSync(f.file),false);
});

test('malformed unified config fails closed without falling back or overwriting either backend',t=>{
  const f=fixture(t); f.legacy();
  for(const content of ['broken JSON','[]','{"grok":null}','{"opencode":{"timeoutMs":0}}','{"grok":{"effort":"ultra"}}','{"typo":{}}','{"grok":{"skipPatterns":[1]}}']) {
    fs.writeFileSync(f.file,content);
    assert.throws(()=>loadProjectConfig(f.root)); assert.throws(()=>resolveConfig(f.root));
    assert.throws(()=>grokInit({cwd:f.root,force:true})); assert.throws(()=>opencodeInit({cwd:f.root,force:true}));
    assert.equal(fs.readFileSync(f.file,'utf8'),content);
    assert.equal(fs.existsSync(f.file+'.lock'),false);
  }
});

test('concurrent initializers retain both sections and concurrent same-backend writes preserve the winner',async t=>{
  const f=fixture(t);
  const results=await Promise.all([runAsync(GROK,f.root,['--model','test-grok']),runAsync(OPENCODE,f.root,['--timeout-ms','3456'])]);
  for(const result of results) assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(f.read().grok.model,'test-grok'); assert.equal(f.read().opencode.timeoutMs,3456);
  const before=fs.readFileSync(f.file,'utf8');
  const preserved=await Promise.all([runAsync(OPENCODE,f.root,['--model','opencode/other-free']),runAsync(OPENCODE,f.root,['--defaults'])]);
  for(const result of preserved) assert.equal(result.status,2,result.stdout+result.stderr);
  assert.equal(fs.readFileSync(f.file,'utf8'),before);
  assert.equal(fs.readdirSync(f.root).some(file=>file.includes('.tmp-') || file.endsWith('.lock')),false);
});

test('grok-init and codex-suite-init produce identical settings and validate missing arguments',t=>{
  const a=fixture(t), b=fixture(t);
  for (const [script,f] of [[GROK,a],[ALIAS,b]]) {
    const result=spawnSync(process.execPath,[script,'--cwd',f.root,'--defaults'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
    const bad=spawnSync(process.execPath,[script,'--model','--defaults'],{encoding:'utf8'});
    assert.equal(bad.status,1); assert.match(JSON.parse(bad.stdout).error,/requires a value/);
  }
  assert.deepEqual(a.read(),b.read());
});
