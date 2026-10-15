#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectProject } from '../../codex-suite-init/scripts/init-config.mjs';
import { validateConfig } from '../../ask-opencode/scripts/opencode-runner.mjs';
import { initializeBackend } from '../../ask-grok/scripts/lib/project-config.mjs';

export function parseArgs(argv) {
  const options = { cwd: process.cwd() };
  const values = { '--cwd':'cwd', '--model':'model', '--timeout-ms':'timeoutMs', '--instructions':'instructions', '--instructions-file':'instructionsFile' };
  for (let index=0; index<argv.length; index++) {
    const flag = argv[index];
    if (['--force','--dry-run','--inspect','--defaults','--migrate'].includes(flag)) {
      options[{ '--force':'force', '--dry-run':'dryRun', '--inspect':'inspect', '--defaults':'defaults', '--migrate':'migrate' }[flag]] = true;
    } else if (values[flag]) {
      if (argv[index+1] === undefined || argv[index+1].startsWith('--')) throw new Error(`${flag} requires a value`);
      options[values[flag]] = argv[++index];
    } else throw new Error(`unknown argument: ${flag}`);
  }
  if (options.timeoutMs !== undefined) options.timeoutMs = Number(options.timeoutMs);
  if (options.instructions !== undefined && options.instructionsFile !== undefined) throw new Error('Choose --instructions or --instructions-file, not both');
  return options;
}

export function renderConfig(project, options = {}) {
  const sourceInstruction = project.sourceDirectories.length
    ? ` Follow existing patterns in ${project.sourceDirectories.map(name => `${name}/`).join(', ')}.`
    : ' Follow the existing repository structure and conventions.';
  const instructions = `This is a ${project.stacks.join(', ')} project.${sourceInstruction}\nUse ${project.testCommand === 'unknown' ? "the repository's documented verification commands" : project.testCommand} for relevant verification.\nPreserve existing public APIs and unrelated changes unless the task explicitly requires otherwise.`;
  const selected = validateConfig({
    ...(options.model !== undefined ? {model:options.model} : {}),
    ...(options.timeoutMs !== undefined ? {timeoutMs:options.timeoutMs} : {}),
    instructions:options.instructions ?? instructions,
  });
  return `${JSON.stringify(selected, null, 2)}\n`;
}

export function runInit(options = {}) {
  const project = detectProject(options.cwd || process.cwd());
  if (options.migrate && ['model','timeoutMs','instructions','instructionsFile','defaults'].some(key => options[key] !== undefined)) {
    throw new Error('--migrate copies legacy settings unchanged; do not combine it with setting overrides');
  }
  return initializeBackend(project, 'opencode', options, () => {
    if (options.instructions !== undefined && options.instructionsFile !== undefined) throw new Error('Choose --instructions or --instructions-file, not both');
    const instructions = options.instructionsFile !== undefined
      ? fs.readFileSync(path.resolve(options.cwd || process.cwd(), options.instructionsFile), 'utf8')
      : options.instructions;
    return JSON.parse(renderConfig(project, {...options, instructions}));
  }, () => {
    const file = path.join(project.root, '.codex-suite.opencode.json');
    if (!fs.existsSync(file)) return null;
    return {file, settings:() => JSON.parse(fs.readFileSync(file, 'utf8'))};
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runInit(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result));
    if (result.status === 'exists') process.exitCode = 2;
  } catch (error) {
    console.log(JSON.stringify({status:'error', error:error.message}));
    process.exitCode = 1;
  }
}
