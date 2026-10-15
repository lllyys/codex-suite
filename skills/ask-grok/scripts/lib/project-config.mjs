import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const CONFIG_FILE = '.codex-suite.json';
export const DEFAULT_OPENCODE_MODEL = 'opencode/muse-spark-1.3-contributor-free';
const MODEL_ID = /^[^\s/\x00-\x1f-][^\s/\x00-\x1f]*\/[^\s\x00-\x1f]+$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);

export function validateBackend(backend, config) {
  if (!object(config)) throw new Error(`${backend} config must be an object`);
  const allowed = backend === 'opencode'
    ? ['model', 'timeoutMs', 'instructions']
    : ['model', 'effort', 'auditType', 'sandbox', 'focusInstructions', 'skipPatterns', 'instructions'];
  for (const key of Object.keys(config)) if (!allowed.includes(key)) throw new Error(`Unknown ${backend} config key: ${key}`);
  for (const key of ['model', 'instructions', 'focusInstructions']) {
    if (own(config, key) && typeof config[key] !== 'string') throw new Error(`${backend}.${key} must be a string`);
  }
  if (own(config, 'model')) {
    if (backend === 'opencode' && !MODEL_ID.test(config.model)) throw new Error('model must be provider/model');
    if (backend === 'grok' && (!config.model.trim() || /\s/.test(config.model) || config.model.startsWith('-'))) throw new Error('grok.model must be a nonempty model slug');
  }
  if (own(config, 'timeoutMs') && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1)) throw new Error('timeoutMs must be a positive integer');
  for (const [key, choices] of Object.entries({
    effort:['none','minimal','low','medium','high','xhigh','max'],
    auditType:['mini','full'],
    sandbox:['read-only','workspace-write','danger-full-access'],
  })) {
    if (own(config, key) && !choices.includes(config[key])) throw new Error(`invalid ${backend}.${key}: ${config[key]}`);
  }
  if (own(config, 'skipPatterns') && (!Array.isArray(config.skipPatterns) || !config.skipPatterns.every(value => typeof value === 'string'))) throw new Error('grok.skipPatterns must be an array of strings');
  return config;
}

export function readUnifiedConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  let config;
  try { config = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {file, config:null}; throw error; }
  if (!object(config)) throw new Error(`${CONFIG_FILE} must be an object`);
  for (const key of Object.keys(config)) {
    if (!['grok','opencode'].includes(key)) throw new Error(`Unknown ${CONFIG_FILE} section: ${key}`);
    validateBackend(key, config[key]);
  }
  return {file, config};
}

export function initializeBackend(project, backend, options, createSettings, loadLegacy) {
  if (options.force && options.migrate) throw new Error('Choose --migrate or --force, not both');
  const configPath = path.join(project.root, CONFIG_FILE);
  const operation = () => {
    const {config} = readUnifiedConfig(project.root);
    const unifiedExists = config !== null && own(config, backend);
    const legacy = unifiedExists ? null : loadLegacy();
    const exists = unifiedExists || legacy !== null;
    const sourceFile = unifiedExists ? configPath : legacy?.file || null;
    const info = {...project, configPath, exists, sourceFile, backend};
    if (options.inspect) return {status:'ok', ...info};
    if (unifiedExists && !options.force || legacy && !options.force && !options.migrate) {
      return {status:'exists', ...info, error:'settings already exist; use --migrate for legacy settings or --force to regenerate this backend'};
    }
    if (options.migrate && !legacy) throw new Error(`No legacy ${backend} settings to migrate`);
    const selected = validateBackend(backend, options.migrate ? legacy.settings() : createSettings());
    const content = `${JSON.stringify({...config, [backend]:selected}, null, 2)}\n`;
    if (!options.dryRun) {
      const temporary = `${configPath}.tmp-${randomUUID()}`;
      try {
        fs.writeFileSync(temporary, content, {encoding:'utf8', mode:0o600, flag:'wx'});
        fs.renameSync(temporary, configPath);
      } finally {
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    return {...info, status:options.dryRun ? 'dry-run' : options.migrate ? 'migrated' : exists ? 'regenerated' : 'created', exists:options.dryRun ? exists : true, selected,
      ...(options.dryRun ? {wouldWrite:true, content} : {})};
  };
  if (options.inspect || options.dryRun) return operation();
  // Serialize section updates so concurrent initializers cannot lose the
  // other backend's settings. Never remove another writer's lock.
  const lock = `${configPath}.lock`;
  const deadline = Date.now() + 5000;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for configuration lock: ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return operation(); } finally { fs.rmdirSync(lock); }
}
