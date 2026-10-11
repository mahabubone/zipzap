/**
 * The write path for `identity.user_merchants` — adding, re-roling and removing a member.
 *
 * Until this existed every membership row in the database was written by the seed, and
 * `MerchantAuthService.revokeSessionsForUser` had nothing to call it. The revocation now happens here,
 * on both paths that change what somebody may do:
 *
 *  - a **removal** ends every session the person holds, immediately. A membership revoked is a
 *    permission revoked, and a session is a standing assertion that permission still holds.
 *  - a **role change** does the same, because a demotion from owner to operator narrows what the
 *    person may do and every live session would otherwise keep the wider set until it expired.
 *
 * Scopes are re-derived per request rather than cached onto a session (migration 0036 dropped
 * `sessions.role` for exactly that), so a demotion stops granting on the next request whether or not
 * the session was revoked. The revoke is what stops a session working at all, which is the stronger
 * guarantee and the one a person leaving a business expects.
 *
 * All queries are schema-qualified because TypeORM's `schema` option sets search_path for the query
 * builder only, not raw SQL — see module-connection.ts.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { MerchantAuthService } from '../merchant/sessions.service.ts';
import { MERCHANT_LOOKUP } from '../merchant/merchant-lookup.ts';
import {
  MemberDisabledError,
  MembershipExistsError,
  MembershipNotFoundError,
  MerchantNotFoundError,
} from '../../common/domain-error.ts';
import {
  assertGrantableRole,
  assertRemovalAllowed,
  assertRoleChangeAllowed,
} from './rules/membership.ts';
import type { RoleName } from './rules/roles.ts';

export interface MemberView {
  readonly userId: string;
  readonly email: string;
  readonly role: RoleName;
  readonly merchantId: string;
  /** Null until the person signs in. Null here is not an error — they have been invited. */
  readonly lastUsedAt: Date | null;
  readonly disabledAt: Date | null;
}

export interface ListMembersResult {
  readonly members: readonly MemberView[];
}

@Injectable()
export class MembershipService {
  constructor(
    @InjectDataSource('identity') private readonly identity: DataSource,
    @Inject(MerchantAuthService) private readonly auth: MerchantAuthService,
    // "Does this business exist" is merchant's answer to give, not identity's to derive. Asking
    // across schemas with raw SQL is the boundary violation the checker names.
    @Inject(MERCHANT_LOOKUP)
    private readonly merchants: { exists(merchantId: string): Promise<boolean> },
  ) {}

  /**
   * Every member of one business.
   *
   * Ordered by role then email so the owner sorts first and the list is stable across pages without
   * an ORDER BY that has to be remembered at the call site.
   */
  async list(merchantId: string): Promise<ListMembersResult> {
    await this.assertMerchantExists(merchantId);
    const rows = (await this.identity.query(
      `SELECT um.user_id, u.email, um.role, um.merchant_id, u.disabled_at
         FROM identity.user_merchants um
         JOIN identity.users u ON u.id = um.user_id
        WHERE um.merchant_id = $1
        ORDER BY CASE WHEN um.role = 'MERCHANT_OWNER' THEN 0 ELSE 1 END, u.email`,
      [merchantId],
    )) as Array<{
      user_id: string;
      email: string;
      role: string;
      merchant_id: string;
      disabled_at: Date | null;
    }>;

    return {
      members: rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        role: row.role as RoleName,
        merchantId: row.merchant_id,
        // `identity.user_merchants` has no `last_used_at`; a member's last activity is the last
        // time one of their sessions was used, and deriving that would join into `merchant`'s
        // schema — which is rule 2. Left null rather than being approximate.
        lastUsedAt: null,
        disabledAt: row.disabled_at,
      })),
    };
  }

  /**
   * Enrol an existing person, or create them and enrol them.
   *
   * A person is identified by email, not by id, because the caller has an email from a colleague and
   * no way to know their user id. An email that already has an account in another business gains a
   * second membership — that is the whole point of `user_merchants` being a join table, and it is why
   * one person can act inside two businesses without two credentials.
   */
  async invite(params: {
    merchantId: string;
    email: string;
    role: string;
    invitedBy: string;
    ip?: string | null;
    requestId?: string | null;
  }): Promise<MemberView> {
    const role = assertGrantableRole(params.role);
    await this.assertMerchantExists(params.merchantId);

    const existing = (await this.identity.query(
      `SELECT id, email, disabled_at FROM identity.users WHERE lower(email) = lower($1)`,
      [params.email],
    )) as Array<{ id: string; email: string; disabled_at: Date | null }>;
    const user = existing[0];

    if (user && user.disabled_at !== null) {
      // Re-inviting a disabled account would silently reactivate it, granting access nobody
      // decided to grant.
      throw new MemberDisabledError();
    }

    const userId = user?.id ?? (await this.createUser(params.email));

    const clash = (await this.identity.query(
      `SELECT 1 FROM identity.user_merchants WHERE user_id = $1 AND merchant_id = $2`,
      [userId, params.merchantId],
    )) as Array<{ '?column?': number }>;
    if (clash.length > 0) {
      throw new MembershipExistsError();
    }

    await this.identity.query(
      `INSERT INTO identity.user_merchants (user_id, merchant_id, role, created_at)
       VALUES ($1, $2, $3, now())`,
      [userId, params.merchantId, role],
    );

    const view = await this.memberView(params.merchantId, userId);
    if (!view) throw new MerchantNotFoundError();
    return view;
  }

  /**
   * Change what a member may do, and end their existing sessions.
   *
   * The session revoke is not optional and not merely tidy: a demotion narrows the scopes a session
   * asserts, and those are derived from the membership on every request — so without a revoke the
   * person would keep working for up to the session's full idle window with the wider set.
   */
  async changeRole(params: {
    merchantId: string;
    userId: string;
    role: string;
    changedBy: string;
    ip?: string | null;
    requestId?: string | null;
  }): Promise<MemberView> {
    const role = assertGrantableRole(params.role);
    await this.assertMerchantExists(params.merchantId);

    const memberships = await this.loadMemberships(params.merchantId);
    assertRoleChangeAllowed(memberships, params.userId, role);

    const target = memberships.find((m) => m.userId === params.userId);
    if (!target) throw new MembershipNotFoundError();

    if (target.role !== role) {
      await this.identity.query(
        `UPDATE identity.user_merchants SET role = $3
          WHERE user_id = $1 AND merchant_id = $2`,
        [params.userId, params.merchantId, role],
      );
      // Only on an actual change: re-PUTting the same role should not sign someone out.
      await this.auth.revokeSessionsForUser(params.userId, {
        merchantId: params.merchantId,
        ip: params.ip ?? null,
        requestId: params.requestId ?? null,
      });
    }

    const view = await this.memberView(params.merchantId, params.userId);
    if (!view) throw new MembershipNotFoundError();
    return view;
  }

  /**
   * Remove a member, and end every session they hold.
   *
   * `revokeSessionsForUser` is not scoped to the business being removed from, deliberately: a person
   * removed from one business may hold a session that was acting inside it, and leaving that session
   * live would keep a revoked membership working until it expired.
   */
  async remove(params: {
    merchantId: string;
    userId: string;
    removedBy: string;
    ip?: string | null;
    requestId?: string | null;
  }): Promise<void> {
    await this.assertMerchantExists(params.merchantId);

    const memberships = await this.loadMemberships(params.merchantId);
    assertRemovalAllowed(memberships, params.userId);

    const target = memberships.find((m) => m.userId === params.userId);
    if (!target) throw new MembershipNotFoundError();

    await this.identity.query(
      `DELETE FROM identity.user_merchants WHERE user_id = $1 AND merchant_id = $2`,
      [params.userId, params.merchantId],
    );

    await this.auth.revokeSessionsForUser(params.userId, {
      merchantId: params.merchantId,
      ip: params.ip ?? null,
      requestId: params.requestId ?? null,
    });
  }

  /** The memberships of one business, enough for the two orphaning rules. */
  private async loadMemberships(
    merchantId: string,
  ): Promise<readonly { readonly userId: string; readonly role: RoleName }[]> {
    const rows = (await this.identity.query(
      `SELECT user_id, role FROM identity.user_merchants WHERE merchant_id = $1`,
      [merchantId],
    )) as Array<{ user_id: string; role: string }>;
    return rows.map((row) => ({
      userId: row.user_id,
      role: row.role as RoleName,
    }));
  }

  /** Reads one membership, or null. Used by the remove route to report who was removed. */
  async memberView(merchantId: string, userId: string): Promise<MemberView | null> {
    const rows = (await this.identity.query(
      `SELECT um.user_id, u.email, um.role, um.merchant_id, u.disabled_at
         FROM identity.user_merchants um
         JOIN identity.users u ON u.id = um.user_id
        WHERE um.merchant_id = $1 AND um.user_id = $2`,
      [merchantId, userId],
    )) as Array<{
      user_id: string;
      email: string;
      role: string;
      merchant_id: string;
      disabled_at: Date | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      email: row.email,
      role: row.role as RoleName,
      merchantId: row.merchant_id,
      lastUsedAt: null,
      disabledAt: row.disabled_at,
    };
  }

  /**
   * Membership is about a business that exists.
   *
   * Checked here rather than left to a foreign key, because `identity.user_merchants` has no FK onto
   * `merchant.merchants` — schemas do not reach into each other in this codebase (rule 2), so the
   * cross-check is a query, and an id for a business that does not exist should be a 404 rather than
   * a row in `identity` describing a phantom.
   */
  private async assertMerchantExists(merchantId: string): Promise<void> {
    // The merchant DataSource is never reached from here: identity does not own `merchant.merchants`,
    // and the presence of a row deciding whether a membership may be written is a question the
    // owning module answers. The boundary checker enforces this, and caught the direct SQL.
    if (!(await this.merchants.exists(merchantId))) throw new MerchantNotFoundError();
  }

  /**
   * Create a person for an email that has no account.
   *
   * There is no password to set: the account has none until a sign-up flow gives it one, and a
   * row that can never authenticate is exactly right for an invited-but-not-yet-signed-up member.
   */
  private async createUser(email: string): Promise<string> {
    const rows = (await this.identity.query(
      `INSERT INTO identity.users (email, password_hash, created_at)
       VALUES ($1, '', now())
       RETURNING id`,
      [email.toLowerCase().trim()],
    )) as Array<{ id: string }>;
    const created = rows[0];
    if (!created) throw new MerchantNotFoundError();
    return created.id;
  }
}
