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
      error: "auth.json is invalid or contains no recognizable credential. Run: grok login",
      grok_version: grokVersion,
    }));
    process.exit(0);
  }
}

if (authMode === "none") {
  emit(payload({
    status: "error",
    error_code: "not_authenticated",
    error: "Grok is not authenticated. Run: grok login, or set XAI_API_KEY.",
    grok_version: grokVersion,
  }));
  process.exit(0);
}

let models = {};
let defaultModel = null;
try {
  const cached = JSON.parse(fs.readFileSync(path.join(grokHome, "models_cache.json"), "utf8"));
  if (cached.models && typeof cached.models === "object" && !Array.isArray(cached.models)) {
    models = cached.models;
  }
  if (typeof cached.default_model === "string") defaultModel = cached.default_model;
} catch {
  // The cache is optional and is populated by Grok itself.
}

const modelIds = Object.keys(models);
if (!defaultModel && modelIds.length > 0) defaultModel = modelIds[0];
const modelDetails = Object.entries(models).map(([slug, config], priority) => ({
  slug,
  display_name: config?.info?.name || slug,
  description: config?.info?.description || "",
  priority,
}));

emit(payload({
  grok_version: grokVersion,
  auth_mode: authMode,
  default_model: defaultModel,
  models: modelIds,
  models_detail: modelDetails,
}));
