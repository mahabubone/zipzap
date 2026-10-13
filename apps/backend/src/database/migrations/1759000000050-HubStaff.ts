import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hub staff assignments: which person works at which hub, and in what role.
 *
 * Why a table and not a `hub_id` column on the user:
 *   - Reassignment is normal (cover another hub for a day, someone leaves).
 *   - A single column cannot tell "never assigned" from "assigned then revoked".
 *   - A single column keeps no history of who worked where.
 *
 * The partial unique index on `user_id` where `revoked_at IS NULL` enforces the
 * one-active-hub-per-person rule at the database, not in app code. App code that
 * races an insert still loses to the index.
 *
 * No foreign keys to identity.users: cross-schema FKs are forbidden (ADR-0002).
 * `user_id` and `hub_id` are uuid columns; referential integrity is the
 * application's job.
 */
export class HubStaff1759000000050 implements MigrationInterface {
  name = 'HubStaff1759000000050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ensuring schema existence
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS hub`);

    await queryRunner.query(`
      CREATE TABLE hub.staff (
        id uuid NOT NULL DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        hub_id uuid NOT NULL,
        role text NOT NULL,
        assigned_at timestamptz NOT NULL DEFAULT now(),
        assigned_by uuid NOT NULL,
        revoked_at timestamptz,
        CONSTRAINT pk_hub_staff PRIMARY KEY (id),
        CONSTRAINT chk_hub_staff_role CHECK (role IN ('MANAGER', 'OPERATOR'))
      );
    `);

    // One active assignment per user. Revoked rows are history and may coexist.
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_hub_staff_user_active
        ON hub.staff (user_id)
        WHERE revoked_at IS NULL;
    `);

    // Find all staff at a hub fast.
    await queryRunner.query(`
      CREATE INDEX idx_hub_staff_hub_active
        ON hub.staff (hub_id)
        WHERE revoked_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE hub.staff;`);
  }
}
