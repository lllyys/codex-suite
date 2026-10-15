#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../codex-suite-init/scripts/init-config.mjs';
export { parseArgs, runInit, detectProject, renderConfig } from '../../codex-suite-init/scripts/init-config.mjs';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
