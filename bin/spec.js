#!/usr/bin/env node
import { run } from '../src/cli/main.js';

run(process.argv.slice(2)).catch((error) => {
  const message = error?.message ?? String(error);
  process.stderr.write(`\n  ✖ ${message}\n\n`);
  process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
});
