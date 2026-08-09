#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const SANDBOX_LEVELS = ["read-only", "workspace-write", "danger-full-access"];
const CREDENTIAL_FIELDS = new Set([
  "key", "api_key", "apikey", "token", "access_token", "accesstoken",
  "refresh_token", "refreshtoken", "id_token", "idtoken",
  "session_token", "sessiontoken", "auth_token", "authtoken",
]);

function payload(patch) {
  return {
    backend: "grok",
    preflight_schema: 1,
    status: "ok",
    grok_version: null,
    auth_mode: "none",
    default_model: null,
    models: [],
    models_detail: [],
    reasoning_efforts: REASONING_EFFORTS,
    sandbox_levels: SANDBOX_LEVELS,
    ...patch,
  };
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function isCredential(value) {
  return typeof value === "string" && value.trim().length >= 8 && !/\s/.test(value.trim());
}

function hasCredential(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 2) return false;
  return Object.entries(value).some(([key, child]) =>
    (CREDENTIAL_FIELDS.has(key.toLowerCase()) && isCredential(child)) ||
    hasCredential(child, depth + 1)
  );
}

function stripTomlComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "#") return line.slice(0, index);
  }
  return line;
}

function parseTomlString(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return null; }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return null;
}

function parseModelTable(section) {
  if (!section.startsWith("model.")) return null;
  const raw = section.slice("model.".length).trim();
  return parseTomlString(raw) || raw || null;
}

function readConfiguredModels(configFile) {
  const configured = new Map();
  let defaultModel = null;
  let section = null;
  try {
    for (const rawLine of fs.readFileSync(configFile, "utf8").split(/\r?\n/)) {
      const line = stripTomlComment(rawLine).trim();
      if (!line) continue;
      const table = line.match(/^\[([^\]]+)\]$/);
      if (table) {
        const name = table[1].trim();
        section = name === "models"
          ? { kind: "models" }
          : parseModelTable(name)
            ? { kind: "model", slug: parseModelTable(name) }
            : null;
        if (section?.kind === "model" && !configured.has(section.slug)) {
          configured.set(section.slug, { slug: section.slug });
        }
        continue;
      }
      const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
      if (!assignment || !section) continue;
      const [, key, rawValue] = assignment;
      const value = parseTomlString(rawValue);
      if (value === null) continue;
      if (section.kind === "models" && key === "default") defaultModel = value;
      if (section.kind === "model") configured.get(section.slug)[key] = value;
    }
  } catch {
    // config.toml is optional; Grok itself remains the final validator.
  }
  return { defaultModel, configured };
}

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, "");
}

function discoverModelsWithGrok() {
  const result = spawnSync("grok", ["models"], {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 15_000,
  });
  const output = stripAnsi(`${result.stdout || ""}\n${result.stderr || ""}`);
  const defaultModel = output.match(/^Default model:\s*(.+?)\s*$/m)?.[1] || null;
  const models = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*]\s+(.+?)(?:\s+\(default\))?\s*$/);
    if (match && !models.includes(match[1])) models.push(match[1]);
  }
  return {
    ok: result.status === 0 && models.length > 0,
    defaultModel,
    models,
  };
}

const version = spawnSync("grok", ["--version"], { encoding: "utf8", stdio: "pipe" });
if (version.error?.code === "ENOENT") {
  emit(payload({
    status: "error",
    error_code: "grok_not_found",
    error: "grok not found on PATH. Install Grok Build from https://x.ai/cli",
  }));
  process.exit(0);
}
if (version.error || version.status !== 0 || version.signal) {
  emit(payload({
    status: "error",
    error_code: "grok_unavailable",
    error: (version.error?.message || version.stderr || version.stdout || "grok --version failed").trim(),
  }));
  process.exit(0);
}

const grokVersion = (version.stdout || version.stderr || "unknown").trim().split(/\r?\n/, 1)[0];
const grokHome = process.env.GROK_HOME || path.join(os.homedir(), ".grok");
const authFile = path.join(grokHome, "auth.json");
const configFile = path.join(grokHome, "config.toml");
let authMode = process.env.XAI_API_KEY ? "api_key" : "none";

if (authMode === "none" && fs.existsSync(authFile)) {
  try {
    const auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
    if (!hasCredential(auth)) throw new Error("no credential-shaped field found");
    authMode = "session";
  } catch {
    emit(payload({
      status: "error",
      error_code: "credentials_unreadable",
      error: "auth.json is invalid or contains no recognizable credential. Run: grok --oauth",
      grok_version: grokVersion,
    }));
    process.exit(0);
  }
}

if (authMode === "none") {
  emit(payload({
    status: "error",
    error_code: "not_authenticated",
    error: "Grok is not authenticated. Run: grok --oauth, or set XAI_API_KEY.",
    grok_version: grokVersion,
  }));
  process.exit(0);
}

let cachedModels = {};
let cachedDefaultModel = null;
try {
  const cached = JSON.parse(fs.readFileSync(path.join(grokHome, "models_cache.json"), "utf8"));
  if (cached.models && typeof cached.models === "object" && !Array.isArray(cached.models)) {
    cachedModels = cached.models;
  }
  if (typeof cached.default_model === "string") cachedDefaultModel = cached.default_model;
} catch {
  // The cache is optional and is populated by Grok itself.
}

const { defaultModel: configuredDefaultModel, configured } = readConfiguredModels(configFile);
const fallbackDetailsBySlug = new Map();
for (const [slug, config] of configured) {
  fallbackDetailsBySlug.set(slug, {
    slug,
    display_name: config.name || slug,
    description: config.description || "",
    source: "config",
  });
}
if (configuredDefaultModel && !fallbackDetailsBySlug.has(configuredDefaultModel)) {
  fallbackDetailsBySlug.set(configuredDefaultModel, {
    slug: configuredDefaultModel,
    display_name: configuredDefaultModel,
    description: "",
    source: "config-default",
  });
}
for (const [slug, config] of Object.entries(cachedModels)) {
  const existing = fallbackDetailsBySlug.get(slug);
  fallbackDetailsBySlug.set(slug, {
    slug,
    display_name: existing?.display_name || config?.info?.name || slug,
    description: existing?.description || config?.info?.description || "",
    source: existing ? "config+cache" : "cache",
  });
}

const cliDiscovery = discoverModelsWithGrok();
const fallbackModelIds = [...fallbackDetailsBySlug.keys()];
const modelIds = cliDiscovery.ok ? cliDiscovery.models : fallbackModelIds;
const defaultModel = cliDiscovery.ok
  ? cliDiscovery.defaultModel || modelIds[0] || null
  : configuredDefaultModel || cachedDefaultModel || modelIds[0] || null;
const modelDetails = modelIds.map((slug, priority) => {
  const metadata = fallbackDetailsBySlug.get(slug);
  return {
    slug,
    display_name: metadata?.display_name || slug,
    description: metadata?.description || "",
    source: cliDiscovery.ok ? "grok-cli" : metadata?.source || "fallback",
    priority,
  };
});
const modelSources = cliDiscovery.ok
  ? ["grok-cli"]
  : [
      ...(configured.size > 0 || configuredDefaultModel ? ["config"] : []),
      ...(Object.keys(cachedModels).length > 0 ? ["cache"] : []),
    ];

emit(payload({
  grok_version: grokVersion,
  auth_mode: authMode,
  default_model: defaultModel,
  models: modelIds,
  models_detail: modelDetails,
  model_sources: modelSources,
  model_discovery: cliDiscovery.ok ? "grok-models" : "config-cache-fallback",
  models_authoritative: cliDiscovery.ok,
}));
