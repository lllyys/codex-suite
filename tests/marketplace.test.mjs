import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("repo marketplace exposes the root codex-suite plugin", () => {
  const marketplace = JSON.parse(
    fs.readFileSync(`${ROOT}/.agents/plugins/marketplace.json`, "utf8"),
  );
  const manifest = JSON.parse(
    fs.readFileSync(`${ROOT}/.codex-plugin/plugin.json`, "utf8"),
  );

  assert.equal(marketplace.name, "codex-suite");
  assert.equal(marketplace.interface.displayName, "Codex Suite");
  assert.equal(marketplace.plugins.length, 1);

  const [plugin] = marketplace.plugins;
  assert.equal(plugin.name, manifest.name);
  assert.deepEqual(plugin.source, {
    source: "local",
    path: "./",
  });
  assert.deepEqual(plugin.policy, {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  });
  assert.equal(plugin.category, "Engineering");
});

test("README documents executable install, update, and removal commands", () => {
  const readme = fs.readFileSync(`${ROOT}/README.md`, "utf8");

  assert.match(readme, /codex plugin marketplace add lllyys\/codex-suite --ref main/);
  assert.match(readme, /codex plugin add codex-suite@codex-suite/);
  assert.match(readme, /codex plugin marketplace upgrade codex-suite/);
  assert.match(readme, /codex plugin remove codex-suite@codex-suite/);
  assert.match(readme, /\/plugins/);
  assert.match(readme, /\/hooks/);
  assert.match(readme, /\$ask-grok Reply with exactly: grok connection ok/);
  assert.doesNotMatch(readme, /<marketplace-name>/);
});
