// Mechanizes the PR-template "node --check passes on touched files" step:
// runs `node --check` on every src/**/*.js so a syntax error can never reach
// a browser unnoticed. Exits non-zero (with the offending files) on failure.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const failed = [];
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    failed.push(relative(ROOT, file));
    process.stderr.write(`✗ ${relative(ROOT, file)}\n${err.stderr?.toString() ?? ''}\n`);
  }
}

if (failed.length) {
  process.stderr.write(`\nnode --check failed on ${failed.length} file(s).\n`);
  process.exit(1);
}
process.stdout.write(`node --check passed on ${files.length} file(s).\n`);
