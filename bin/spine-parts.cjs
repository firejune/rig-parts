#!/usr/bin/env node
'use strict';

/**
 * spine-parts' `bin` entry has one job: hand off to Bun.
 *
 * npm's `bin` field has to be something any installed Node can run, but
 * spine-parts is a Bun program (it runs its TypeScript sources directly, and so
 * does spine-rigc underneath it). Without this file, a machine with no Bun
 * would fail as a bare `env: bun: No such file or directory`, with no hint
 * why. So: if `bun` is on PATH, run the real CLI (cli.ts, next to this file)
 * under it and disappear — argv, stdio, the exit code and signals all pass
 * straight through. If it isn't, say so once and stop. No downloads, no
 * network, no writes — just the hand-off or the message.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = path.join(__dirname, '..', 'cli.ts');
const result = spawnSync('bun', [cli, ...process.argv.slice(2)], { stdio: 'inherit' });

if (result.error) {
  if (result.error.code === 'ENOENT') {
    process.stderr.write('spine-parts runs on Bun, which was not found on PATH — install it from https://bun.sh\n');
  } else {
    process.stderr.write(`spine-parts: could not launch bun: ${result.error.message}\n`);
  }
  process.exit(1);
}

if (result.signal) {
  // A signal (e.g. Ctrl-C) killed the child — die the same way instead of
  // inventing an exit code, so the caller sees what it would have seen running
  // bun directly.
  process.kill(process.pid, result.signal);
} else {
  process.exit(typeof result.status === 'number' ? result.status : 1);
}
