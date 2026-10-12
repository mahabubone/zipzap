/**
 * Reading `identity.users` and `identity.user_merchants`. Own schema only.
 *
 * merchant's session issuance calls this rather than reading these tables, because a person's
 * password hash living inside `merchant` is precisely the coupling this module exists to undo. The
 * direction is identity-exposes, merchant-consumes — the same seam as `FindCredentialService`, in
 * the other direction.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { RoleName } from './rules/roles.ts';
import type { Membership, PrincipalMemberships } from './rules/users.ts';

export interface FoundUser extends PrincipalMemberships {
  readonly passwordHash: string;
  readonly displayName: string | null;
  readonly disabledAt: Date | null;
}

@Injectable()
export class UserService {
  constructor(@InjectDataSource('identity') private readonly identity: DataSource) {}

  /**
   * Table names are schema-qualified because TypeORM's `schema` option sets search_path for the
   * query builder, not for raw SQL — see module-connection.ts.
   */
  async findByEmail(email: string): Promise<FoundUser | null> {
    return this.load(`WHERE lower(u.email) = lower($1)`, [email]);
  }

  async findById(userId: string): Promise<FoundUser | null> {
    return this.load(`WHERE u.id = $1`, [userId]);
  }

  private async load(predicate: string, params: unknown[]): Promise<FoundUser | null> {
    const rows = await this.identity.query(
      `SELECT u.id, u.email, u.password_hash, u.display_name, u.disabled_at, um.merchant_id, um.role
         FROM identity.users u
         LEFT JOIN identity.user_merchants um ON um.user_id = u.id
        ${predicate}
        ORDER BY um.merchant_id`,
      params,
    );
    const first = rows[0] as
      | {
          id: string;
          email: string;
          password_hash: string;
          display_name: string | null;
          disabled_at: Date | null;
          merchant_id: string | null;
          role: string | null;
        }
      | undefined;
    if (!first) return null;

    // A user with no memberships still authenticates — they simply cannot act anywhere, which
    // `resolveActiveMerchant` refuses. Dropping them here would turn "no access" into "bad
    // password", and those are different problems with different fixes.
    const memberships: Membership[] = rows
      .filter((row: { merchant_id: string | null }) => row.merchant_id !== null)
      .map((row: { merchant_id: string; role: string }) => ({
        merchantId: row.merchant_id,
        // The column has a CHECK, so the cast holds in practice — but the cast is NOT the
        // validation. `roleForMerchant` re-checks with `isRoleName` and throws on anything it does
        // not recognise, which is what stops a widened role vocabulary from silently widening an
        // already-issued token. Substituting a default role here would defeat exactly that.
        role: row.role as RoleName,
      }));

    return {
      userId: first.id,
      email: first.email,
      passwordHash: first.password_hash,
      displayName: first.display_name,
      disabledAt: first.disabled_at,
      memberships,
    };
  }

  /**
   * The name to render for a person, and nothing else.
   *
   * A console has to answer "who am I" from somewhere. It used to answer it with
   * `principal.subjectId`, which is a UUID — technically correct, and unreadable, so every
   * screenshot of every authenticated screen carried a row of hex in its sidebar.
   *
   * Deliberately NOT `load()`: that joins every membership and reads the password hash to return a
   * name. `GET /v1/me` runs on every console render, and dragging the credential material across
   * that boundary to get one string would be the wrong trade. Falls back to the email rather than
   * null, because "no display name" should still render as a person and not as an empty corner.
   */
  async findDisplayName(userId: string): Promise<string | null> {
    const rows = await this.identity.query(
      `SELECT u.display_name, u.email FROM identity.users u WHERE u.id = $1`,
      [userId],
    );
    const row = rows[0] as { display_name: string | null; email: string } | undefined;
    if (!row) return null;
    const name = row.display_name?.trim();
    return name ? name : row.email;
  }
}
