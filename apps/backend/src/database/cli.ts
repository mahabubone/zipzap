/**
 * `pnpm db:migrate` · `db:revert` · `db:seed` · `analytics:rebuild`
 *
 * A thin wrapper over typeorm's MigrationExecutor rather than the typeorm CLI, so it runs
 * from the same compiled output as the app and needs no ts-node.
 */

import { dataSource } from './data-source';
import { rebuild } from './analytics-rebuild';

function argValue(flag: string): string | undefined {
  const prefixed = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'migrate';
  await dataSource.initialize();
  try {
    if (command === 'migrate') {
      const applied = await dataSource.runMigrations({ transaction: 'all' });
      console.log(
        applied.length > 0 ? `applied ${applied.length} migration(s)` : 'already up to date',
      );
    } else if (command === 'revert') {
      await dataSource.undoLastMigration({ transaction: 'all' });
      console.log('reverted last migration');
    } else if (command === 'seed') {
      // Seed lives in the source tree; run it from dist so relative imports resolve.
      // @ts-expect-error dynamic import of a .mjs script
      await import('../../scripts/seed.mjs');
    } else if (command === 'rebuild') {
      const { replayed, applied } = await rebuild(dataSource, argValue('--from') ?? '1970-01-01');
      console.log(
        `rebuilt analytics projections: replayed ${replayed} event(s), applied ${applied}`,
      );
    } else {
      console.error(`unknown command "${command}" — expected migrate | revert | seed | rebuild`);
      process.exitCode = 1;
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
