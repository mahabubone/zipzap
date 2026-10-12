/**
 * Build, and fail loudly if `dist/` cannot be written.
 *
 * `nest build` alone is a trap here. With `deleteOutDir: true` in nest-cli.json, tsc renames the
 * existing `dist` out of the way before writing the new one — and on 2026-10-10 a build ran as
 * root, leaving a root-owned `dist.root-owned/` behind. Every later build as a normal user then
 * hit EACCES trying to remove it, **and still exited 0**. The symptom was an empty `dist/`, so
 * every integration suite failed to resolve `dist/database/module-connection.js` and reported 16
 * unrelated "cannot find module" errors while `pnpm build` reported success.
 *
 * That is the worst failure mode available: a green build command that produces nothing, followed
 * by a wall of errors pointing at the tests instead of at the cause. So this wrapper:
 *
 *   1. builds, then
 *   2. verifies the three entrypoints exist, and
 *   3. exits non-zero with an actionable message if anything is missing.
 *
 * A build that cannot produce a runnable artifact is a failed build, and it should say so in the
 * one command a developer actually ran.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What the module graph actually boots. Three entrypoints, one build. */
const REQUIRED = ['main.js', 'worker.js', 'publisher.js'];

// The LOCAL @nestjs/cli, resolved from node_modules — never a global `nest`. A globally installed
// CLI on the PATH can be a different major version, and when it is, it refuses to run at all
// ("outdated and incompatible with the local version (which requires ESM)"). That is a confusing
// way to fail, because the package.json devDependency is present and correct.
const nestBin = resolve(backendRoot, 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js');

if (!existsSync(nestBin)) {
  console.error(
    `Cannot find the local @nestjs/cli at ${nestBin}. Run \`pnpm install\` before building.`,
  );
  process.exit(1);
}

const build = spawnSync(process.execPath, [nestBin, 'build', '--path', 'tsconfig.json'], {
  cwd: backendRoot,
  stdio: 'inherit',
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const missing = REQUIRED.filter((entry) => !existsSync(resolve(backendRoot, 'dist', entry)));

if (missing.length > 0) {
  console.error(
    [
      '',
      `build reported success but dist/ is missing: ${missing.join(', ')}`,
      '',
      'The usual cause is a dist directory this user cannot delete — `deleteOutDir: true` makes',
      'tsc move the old one aside first, and a build that once ran as root leaves a root-owned',
      'directory that a normal build cannot remove.',
      '',
      `  ls -la ${resolve(backendRoot, 'dist')}`,
      '  sudo rm -rf apps/backend/dist*',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
