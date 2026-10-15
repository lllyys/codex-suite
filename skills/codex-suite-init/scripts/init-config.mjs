#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { resolveWorkspaceRoot } from "../../ask-grok/scripts/lib/workspace.mjs";
import { CONFIG_FILE, initializeBackend } from "../../ask-grok/scripts/lib/project-config.mjs";
import { grokSettings, loadLegacyProjectConfig, parseGrokMarkdown } from "../../ask-grok/scripts/lib/config.mjs";

const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
const AUDIT_TYPES = new Set(["mini", "full"]);
const FOCUSES = new Set(["balanced", "security-first", "performance-first", "quality-first"]);
const SANDBOXES = new Set(["per-skill", "read-only", "workspace-write", "danger-full-access"]);

const FOCUS_INSTRUCTIONS = {
  balanced: "Give equal attention to all audit dimensions.",
  "security-first": "Prioritize security findings. Treat auth bypass, injection, data exposure, and cryptographic weaknesses as Critical when impact warrants it.",
  "performance-first": "Prioritize performance findings. Pay special attention to N+1 queries, quadratic algorithms, memory leaks, and blocking I/O.",
  "quality-first": "Prioritize code quality findings. Pay special attention to untested critical paths, high complexity, duplication, and incomplete error handling.",
};

const DEFAULT_SKIPS = [
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  "vendor/",
  "generated/",
  "*.min.js",
  "*.bundle.js",
  ".git/",
];

function exists(root, name) {
  return fs.existsSync(path.join(root, name));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function packageManager(root) {
  if (exists(root, "pnpm-lock.yaml")) return "pnpm";
  if (exists(root, "yarn.lock")) return "yarn";
  if (exists(root, "bun.lock") || exists(root, "bun.lockb")) return "bun";
  return "npm";
}

export function detectProject(candidate) {
  const root = resolveWorkspaceRoot(candidate);
  const stacks = [];
  const packageJson = readJson(path.join(root, "package.json"));
  if (packageJson) stacks.push("Node.js");
  if (exists(root, "pyproject.toml") || exists(root, "requirements.txt")) stacks.push("Python");
  if (exists(root, "go.mod")) stacks.push("Go");
  if (exists(root, "Cargo.toml")) stacks.push("Rust");
  if (exists(root, "Gemfile")) stacks.push("Ruby");
  if (exists(root, "pom.xml") || exists(root, "build.gradle") || exists(root, "build.gradle.kts")) stacks.push("Java");
  if (fs.readdirSync(root).some((name) => /\.(?:csproj|sln)$/.test(name))) stacks.push(".NET");

  const sourceDirectories = [
    "src", "lib", "app", "packages", "services", "cmd", "internal",
    "skills", "scripts", "tests", "test",
  ]
    .filter((name) => exists(root, name));

  let testCommand = "unknown";
  if (packageJson?.scripts?.test) testCommand = `${packageManager(root)} test`;
  else if (exists(root, "pytest.ini") || exists(root, "conftest.py") || exists(root, "pyproject.toml")) testCommand = "pytest";
  else if (exists(root, "go.mod")) testCommand = "go test ./...";
  else if (exists(root, "Cargo.toml")) testCommand = "cargo test";
  else if (exists(root, "Gemfile") && exists(root, "spec")) testCommand = "bundle exec rspec";
  else if (exists(root, "pom.xml")) testCommand = "mvn test";
  else if (exists(root, "build.gradle") || exists(root, "build.gradle.kts")) testCommand = "./gradlew test";
  else if (stacks.includes(".NET")) testCommand = "dotnet test";

  return {
    root,
    configPath: path.join(root, CONFIG_FILE),
    exists: exists(root, CONFIG_FILE),
    stacks: stacks.length > 0 ? stacks : ["unknown"],
    sourceDirectories,
    testCommand,
  };
}

function validateChoice(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`invalid ${label}: ${value}`);
}

export function renderConfig(project, options = {}) {
  const model = String(options.model || "latest").trim();
  const effort = String(options.effort || "high").trim();
  const auditType = String(options.auditType || "mini").trim();
  const focus = String(options.focus || "balanced").trim();
  const sandbox = String(options.sandbox || "per-skill").trim();
  if (!model) throw new Error("model cannot be empty");
  validateChoice(effort, EFFORTS, "effort");
  validateChoice(auditType, AUDIT_TYPES, "audit type");
  validateChoice(focus, FOCUSES, "focus");
  validateChoice(sandbox, SANDBOXES, "sandbox");

  const stack = project.stacks.join(", ");
  const sources = project.sourceDirectories.length > 0
    ? project.sourceDirectories.map((name) => `${name}/`).join(", ")
    : "not detected";
  const sandboxLine = sandbox === "per-skill" ? "" : `- **Default sandbox**: ${sandbox}\n`;
  const sourceInstruction = project.sourceDirectories.length > 0
    ? ` Follow existing patterns in ${project.sourceDirectories.map((name) => `${name}/`).join(", ")}.`
    : " Follow the existing repository structure and conventions.";

  return `# Codex Suite Configuration

Project-specific settings for Codex → Grok delegation.
Generated by \`$codex-suite-init\`. Edit freely; every field is optional.

## Project

- **Stack**: ${stack}
- **Test command**: ${project.testCommand}
- **Source directories**: ${sources}

## Defaults

Explicit invocation options override these values. Remove a line to use the
calling skill's built-in default.

- **Default model**: ${model}
- **Default effort**: ${effort}
- **Default audit type**: ${auditType}
${sandboxLine}
## Audit Focus

Selected profile: ${focus}

\`\`\`text
${FOCUS_INSTRUCTIONS[focus]}
\`\`\`

## Skip Patterns

Audits skip these paths. Implementation treats them as leave-untouched paths.

\`\`\`text
${DEFAULT_SKIPS.join("\n")}
\`\`\`

## Project-Specific Instructions

These instructions are included in every delegated Grok request.

\`\`\`text
This is a ${stack} project.${sourceInstruction}
Use ${project.testCommand === "unknown" ? "the repository's documented verification commands" : project.testCommand} for relevant verification.
Preserve existing public APIs and unrelated changes unless the task explicitly requires otherwise.
\`\`\`
`;
}

export function parseArgs(argv) {
  const options = {cwd:process.cwd()};
  const values = {'--cwd':'cwd', '--model':'model', '--effort':'effort', '--audit-type':'auditType', '--focus':'focus', '--sandbox':'sandbox'};
  const flags = {'--force':'force', '--dry-run':'dryRun', '--inspect':'inspect', '--defaults':'defaults', '--migrate':'migrate'};
  for (let index=0; index<argv.length; index++) {
    const arg = argv[index];
    if (flags[arg]) options[flags[arg]] = true;
    else if (values[arg]) {
      if (!argv[index+1] || argv[index+1].startsWith('--')) throw new Error(`${arg} requires a value`);
      options[values[arg]] = argv[++index];
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

export function runInit(options = {}) {
  const project = detectProject(options.cwd || process.cwd());
  if (options.migrate && ['model','effort','auditType','focus','sandbox','defaults'].some(key => options[key] !== undefined)) {
    throw new Error('--migrate copies legacy settings unchanged; do not combine it with setting overrides');
  }
  return initializeBackend(project, 'grok', options,
    () => {
      const settings = grokSettings(parseGrokMarkdown(renderConfig(project, options)));
      // Validate the supplied slug itself rather than a Markdown line parsed
      // from it, which could otherwise hide embedded newlines.
      if (options.model !== undefined) settings.model = String(options.model).trim();
      return settings;
    },
    () => {
      const file = path.join(project.root, '.codex-suite.md');
      if (!fs.existsSync(file)) return null;
      return {file, settings:() => grokSettings(loadLegacyProjectConfig(project.root))};
    });
}

export function main() {
  try {
    const result = runInit(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status === 'exists') process.exitCode = 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({status:'error', error:error.message})}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
