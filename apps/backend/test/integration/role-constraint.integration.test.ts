/**
 * Integration: the database's list of roles is the same list the code has.
 *
 * `identity.user_merchants.role` is `text` with a CHECK constraint rather than an enum, and the two
 * drifted: `ROLE_NAMES` gained `HUB_MANAGER` when hub assignment landed, and the constraint did not.
 * The role therefore existed in code, carried scopes, appeared in the documentation, and could not be
 * assigned to anybody — `hub:manage` was reachable by a `PLATFORM_ADMIN` and by nothing else.
 *
 * This suite asserts the two lists agree, for every role, against the live database. It is the
 * invariant that would have caught it, and it is cheap: a constraint violation is a database error
 * rather than a type error, so nothing in `pnpm typecheck` or the unit suites can see this.
 *
 * ## Why it inserts and deletes rather than reading the constraint
 *
 * Reading `pg_constraint` would assert the literal list, which is the thing that went stale — a fourth
 * copy of it, in a test. Writing each role proves the constraint accepts it, which is the property that
 * matters, and a new role in `ROLE_NAMES` makes this fail with that role's name.
 */

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { MerchantEntity } from '../../dist/modules/merchant/merchant.entity.js';
import { ROLE_NAMES } from '../../dist/modules/identity/rules/roles.js';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

let identityDb: DataSource;
let merchantDb: DataSource;
let merchantId: string;

before(async () => {
  identityDb = await connectModuleDataSource('identity', []);
  merchantDb = await connectModuleDataSource('merchant', [MerchantEntity]);

  merchantId = randomUUID();
  await merchantDb.query(
    `INSERT INTO merchant.merchants (id, name, status, contact_email)
     VALUES ($1, 'Role probe', 'ACTIVE', 'role-probe@example.test')`,
    [merchantId],
  );
});

after(async () => {
  // Everything this file created, by id — never by truncating a table.
  await identityDb.query('DELETE FROM identity.user_merchants WHERE merchant_id = $1', [
    merchantId,
  ]);
  await merchantDb.query('DELETE FROM merchant.merchants WHERE id = $1', [merchantId]);
  await identityDb.destroy();
  await merchantDb.destroy();
});

describeIfDb('identity.user_merchants role constraint', () => {
  test('every role the code defines can be assigned', async () => {
    const refused: string[] = [];

    for (const role of ROLE_NAMES) {
      const userId = randomUUID();
      await identityDb.query(
        'INSERT INTO identity.users (id, email, password_hash) VALUES ($1, $2, $3)',
        [userId, `role-${role.toLowerCase()}-${randomUUID()}@example.test`, 'x'],
      );
      try {
        await identityDb.query(
          'INSERT INTO identity.user_merchants (user_id, merchant_id, role) VALUES ($1, $2, $3)',
          [userId, merchantId, role],
        );
      } catch (error) {
        refused.push(`${role}: ${(error as { code?: string }).code ?? 'unknown'}`);
      } finally {
        await identityDb.query('DELETE FROM identity.users WHERE id = $1', [userId]);
      }
    }

    assert.deepEqual(
      refused,
      [],
      `the database refuses roles the code defines — ${refused.join('; ')}. ` +
        'Either add the role to the CHECK constraint in a migration, or remove it from ROLE_NAMES.',
    );
  });

  test('a role nobody defines is still refused', async () => {
    // The other direction. Widening a constraint to match a code list is only safe while the constraint
    // is still the narrower of the two, or `role: 'HUB_MANAGR'` becomes a third way to be a manager.
    const userId = randomUUID();
    await identityDb.query(
      'INSERT INTO identity.users (id, email, password_hash) VALUES ($1, $2, $3)',
      [userId, `role-probe-typo-${randomUUID()}@example.test`, 'x'],
    );
    try {
      await assert.rejects(
        identityDb.query(
          'INSERT INTO identity.user_merchants (user_id, merchant_id, role) VALUES ($1, $2, $3)',
          [userId, merchantId, 'HUB_MANAGR'],
        ),
        (error: { code?: string }) => error.code === '23514',
        'a misspelled role was accepted',
      );
    } finally {
      await identityDb.query('DELETE FROM identity.users WHERE id = $1', [userId]);
    }
  });
});
