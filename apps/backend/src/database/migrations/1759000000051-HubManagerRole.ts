import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `HUB_MANAGER` becomes a role a membership can actually name.
 *
 * ## The gap
 *
 * `identity.user_merchants.role` had a CHECK constraint listing seven roles. `ROLE_NAMES` in
 * `modules/identity/rules/roles.ts` lists eight — the eighth is `HUB_MANAGER`, added with the hub
 * assignment work, which is what made a person's *position in the network* a thing the identity module
 * knows about. The constraint was written before that and never widened.
 *
 * So the role existed in code, carried scopes (`hub:manage` above everything a `HUB_OPERATOR` holds),
 * appeared in the roles documentation, and could not be assigned to anybody. `hub:manage` was reachable
 * by a `PLATFORM_ADMIN` and by nothing else — which is not what "Held by HUB_MANAGER and PLATFORM_ADMIN
 * only" in `common/scopes.ts` describes.
 *
 * It surfaced while writing a browser proof that needed a hub manager: the fixture tried to mint the
 * role a depot actually issues and the database refused, with an error about a constraint rather than
 * about anything a person would recognise.
 *
 * ## The fix
 *
 * Drop and re-add the constraint with all eight roles. The column is `text` with a CHECK rather than an
 * enum type, so widening it is a constraint swap and not an `ALTER TYPE` that cannot run inside a
 * transaction.
 */
export class HubManagerRole1759000000051 implements MigrationInterface {
  name = 'HubManagerRole1759000000051';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE identity.user_merchants DROP CONSTRAINT IF EXISTS user_merchants_role_check
    `);
    await queryRunner.query(`
      ALTER TABLE identity.user_merchants ADD CONSTRAINT user_merchants_role_check CHECK (role IN (
        'PLATFORM_ADMIN','OPERATIONS_MANAGER','HUB_MANAGER','HUB_OPERATOR','SUPPORT_AGENT',
        'MERCHANT_OWNER','MERCHANT_OPERATOR','RIDER'
      ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Narrowing, so this refuses to run while a HUB_MANAGER exists rather than deleting somebody's
    // role on the way down. A `down` that silently corrupts is worse than a `down` that fails.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM identity.user_merchants WHERE role = 'HUB_MANAGER') THEN
          RAISE EXCEPTION
            'cannot narrow user_merchants_role_check: % memberships hold HUB_MANAGER',
            (SELECT count(*) FROM identity.user_merchants WHERE role = 'HUB_MANAGER');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE identity.user_merchants DROP CONSTRAINT IF EXISTS user_merchants_role_check
    `);
    await queryRunner.query(`
      ALTER TABLE identity.user_merchants ADD CONSTRAINT user_merchants_role_check CHECK (role IN (
        'PLATFORM_ADMIN','OPERATIONS_MANAGER','HUB_OPERATOR','SUPPORT_AGENT',
        'MERCHANT_OWNER','MERCHANT_OPERATOR','RIDER'
      ))
    `);
  }
}
