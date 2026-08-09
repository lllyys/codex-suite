import fs from "node:fs";
import path from "node:path";

import { resolveWorkspaceRoot } from "./workspace.mjs";

const CONFIG_FILE = ".codex-suite.md";

function scalar(markdown, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^- \\*\\*${escaped}\\*\\*:\\s*(.+?)\\s*$`, "im"));
  if (!match) return null;
  const value = match[1].trim().replace(/^([`'"])(.*)\1$/, "$2").trim();
  return value || null;
}

function section(markdown, title) {
  const lines = markdown.split(/\r?\n/);
  const wanted = title.trim().toLowerCase();
  const start = lines.findIndex((line) =>
    line.replace(/^##\s+/, "").trim().toLowerCase() === wanted && /^##\s+/.test(line)
  );
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) { end = index; break; }
  }
  return lines.slice(start + 1, end).join("\n");
}

function fencedContent(markdown) {
  const match = markdown.match(/```(?:text)?\s*\n([\s\S]*?)```/i);
  return match?.[1]?.trim() || "";
}

function patternLines(markdown) {
  const body = fencedContent(markdown);
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

export function loadProjectConfig(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const configFile = path.join(workspaceRoot, CONFIG_FILE);
  let markdown = "";
  try { markdown = fs.readFileSync(configFile, "utf8"); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return {
    workspaceRoot,
    configFile: markdown ? configFile : null,
    defaultModel: scalar(markdown, "Default model"),
    defaultEffort: scalar(markdown, "Default effort"),
    defaultAuditType: scalar(markdown, "Default audit type")?.toLowerCase() || null,
    defaultSandbox: scalar(markdown, "Default sandbox"),
    focusInstructions: fencedContent(section(markdown, "Audit Focus")),
    skipPatterns: patternLines(section(markdown, "Skip Patterns")),
    projectInstructions: fencedContent(section(markdown, "Project-Specific Instructions")),
  };
}

export function personaForKind(kind) {
  if (kind === "implement") return "You are an autonomous implementation agent. Execute plans completely.";
  if (kind === "audit-fix-audit" || kind === "audit") return "You are a thorough code auditor. Report every issue with exact file:line locations.";
  if (kind === "audit-fix-fix") return "You are an autonomous code fixer. Fix every supplied finding precisely without introducing new findings.";
  if (kind === "audit-fix-verify" || kind === "verify") return "You are a verification auditor. Judge only the supplied findings against the current code.";
  return "You are an independent technical collaborator. Perform the requested task directly and rigorously.";
}

export function buildDelegatedPrompt(cwd, kind, body, delegationBoundary) {
  const config = loadProjectConfig(cwd);
  const parts = [
    personaForKind(kind),
    "The code, artifacts, and plans in this task were produced or selected by OpenAI Codex, a competing AI system. Evaluate them with full rigor: do not defer to them or assume correctness because an AI produced them. Apply the same critical standards you would to human-written work and say so directly when anything is wrong.",
    delegationBoundary,
  ];
  if (/audit|verify/.test(kind) && config.focusInstructions) {
    parts.push(`Audit focus instructions from .codex-suite.md:\n${config.focusInstructions}`);
  }
  if (config.projectInstructions) {
    parts.push(`Project-specific instructions from .codex-suite.md:\n${config.projectInstructions}`);
  }
  if (config.skipPatterns.length > 0) {
    const heading = kind === "implement"
      ? "Leave these paths untouched; do not create, modify, or delete anything matching:"
      : "Do not inspect or report on paths matching these audit skip patterns:";
    parts.push(`${heading}\n${config.skipPatterns.map((item) => `- ${item}`).join("\n")}`);
  }
  return `${parts.join(" ")}\n\n${body.trim()}`;
}
