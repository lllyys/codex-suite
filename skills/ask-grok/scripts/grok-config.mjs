#!/usr/bin/env node

import process from "node:process";

import { loadProjectConfig } from "./lib/config.mjs";

try {
  process.stdout.write(`${JSON.stringify(loadProjectConfig(process.argv[2] || process.cwd()))}\n`);
} catch (error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
}
