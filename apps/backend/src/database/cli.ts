/**
 * `pnpm db:migrate` · `db:revert` · `db:seed`
 *
 * A thin wrapper over typeorm's MigrationExecutor rather than the typeorm CLI, so it runs
 * from the same compiled output as the app and needs no ts-node.
 */

import { dataSource } from './data-source';

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
    } else {
      console.error(`unknown command "${command}" — expected migrate | revert | seed`);
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
