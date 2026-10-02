/**
 * Dev runner: boots all three entrypoints against one build.
 *
 * A 30-line script beats a concurrency dependency for three fixed child processes.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envFile = resolve(root, '.env');

const targets = [
  { name: 'api', entry: 'dist/main.js' },
  { name: 'worker', entry: 'dist/worker.js' },
  { name: 'publisher', entry: 'dist/publisher.js' },
];

const children = [];
let shuttingDown = false;

for (const target of targets) {
  const child = spawn(process.execPath, ['--env-file-if-exists', envFile, target.entry], {
    stdio: 'inherit',
    cwd: resolve(root, 'apps/backend'),
  });
  child.on('exit', (code) => {
    console.error(`[dev] ${target.name} exited with code ${code}`);
    if (!shuttingDown) shutdown(code ?? 1);
  });
  children.push(child);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
