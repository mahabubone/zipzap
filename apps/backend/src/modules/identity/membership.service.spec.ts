/**
 * The membership write path's revocation, which is the reason any of it exists.
 *
 * `MerchantAuthService.revokeSessionsForUser` was written and tested in the session-lifetime commit
 * and had nothing to call it, because the API had no way to change a privilege. These tests pin the
 * two callers now that they exist, and the one behaviour that makes them worth having:
 *
 * a **removal** must end every session immediately. A membership revoked is a permission revoked,
 * and a session is a standing assertion that the permission still holds — so leaving the session
 * live would keep a removed employee working until it expired, for up to seven days.
 *
 * A **role change** does the same, but only when the role actually changes. Re-PUTting the same role
 * is an idempotent no-op, and evicting somebody for it would turn a polling console into a logout
 * mechanism.
 *
 * The service is constructed directly rather than through the Nest container: it needs a DataSource
 * and another module's service, and the assertions are about SQL and calls, not about DI.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MembershipService } from './membership.service.ts';
import { MerchantAuthService } from '../merchant/sessions.service.ts';
import {
  MemberDisabledError,
  MembershipExistsError,
  MembershipNotFoundError,
} from '../../common/domain-error.ts';

/** A DataSource stub whose scripted rows are queued per query. */
function dataSource(scripts: unknown[][]) {
  const calls: unknown[][] = [];
  let index = 0;
  return {
    query: vi.fn(async (...params: unknown[]) => {
      calls.push(params);
      const result = scripts[Math.min(index, scripts.length - 1)];
      index += 1;
      return result ?? [];
    }),
    calls,
  };
}

/** One owner and one operator, which is the ordinary two-person business. */
const TWO_MEMBERS = [
  { user_id: 'u-owner', role: 'MERCHANT_OWNER' },
  { user_id: 'u-operator', role: 'MERCHANT_OPERATOR' },
];

const MERCHANT = 'm-1';

/** The merchant-existence seam, stubbed. `true` = the business exists. */
const merchants = { exists: vi.fn(async () => true) };

function makeService(
  auth: { revokeSessionsForUser: ReturnType<typeof vi.fn> },
  scripts: unknown[][],
) {
  const identity = dataSource(scripts);
  const service = new MembershipService(
    identity as unknown as ConstructorParameters<typeof MembershipService>[0],
    auth as unknown as MerchantAuthService,
    merchants,
  );
  return { service, identity };
}

describe('MembershipService', () => {
  let auth: { revokeSessionsForUser: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auth = { revokeSessionsForUser: vi.fn().mockResolvedValue(1) };
    merchants.exists.mockReset();
    merchants.exists.mockResolvedValue(true);
  });

  describe('removing a member', () => {
    it('revokes every session the person holds', async () => {
      // The whole point. A removed member with a live session is a removed member who can still work.
      const { service } = makeService(auth, [
        TWO_MEMBERS, // load memberships
        [], // DELETE
      ]);

      await service.remove({
        merchantId: MERCHANT,
        userId: 'u-operator',
        removedBy: 'u-owner',
      });

      expect(auth.revokeSessionsForUser).toHaveBeenCalledWith(
        'u-operator',
        // `reason` is NOT passed: `revokeSessionsForUser` derives it from whether a context was
        // given, which is how a membership-driven revoke and a manual one stay distinguishable
        // without every caller having to remember to say which it was.
        expect.objectContaining({ merchantId: MERCHANT, ip: null, requestId: null }),
      );
    });

    it('refuses to remove the last owner, and does not touch the database', async () => {
      const { service, identity } = makeService(auth, [TWO_MEMBERS]);

      await expect(
        service.remove({ merchantId: MERCHANT, userId: 'u-owner', removedBy: 'u-operator' }),
      ).rejects.toThrow(/last owner/);

      // No DELETE and no revoke: refusing has to be a no-op, not a partial removal.
      expect(identity.query).not.toHaveBeenCalledWith(
        expect.stringContaining('DELETE'),
        expect.anything(),
      );
      expect(auth.revokeSessionsForUser).not.toHaveBeenCalled();
    });

    it('404s for somebody who is not a member of this business', async () => {
      const { service } = makeService(auth, [TWO_MEMBERS]);

      await expect(
        service.remove({ merchantId: MERCHANT, userId: 'u-stranger', removedBy: 'u-owner' }),
      ).rejects.toThrow(MembershipNotFoundError);
      expect(auth.revokeSessionsForUser).not.toHaveBeenCalled();
    });
  });

  describe('changing a role', () => {
    it('revokes sessions when the role actually changes', async () => {
      // A demotion narrows what a session asserts, and the scopes are derived from the membership on
      // every request — so without a revoke the person keeps the wider set for the whole idle window.
      const { service } = makeService(auth, [
        TWO_MEMBERS,
        [
          {
            user_id: 'u-operator',
            email: 'op@x.test',
            role: 'MERCHANT_OWNER',
            merchant_id: MERCHANT,
            disabled_at: null,
          },
        ],
      ]);

      await service.changeRole({
        merchantId: MERCHANT,
        userId: 'u-operator',
        role: 'MERCHANT_OWNER',
        changedBy: 'u-owner',
      });

      expect(auth.revokeSessionsForUser).toHaveBeenCalledWith(
        'u-operator',
        expect.objectContaining({ merchantId: MERCHANT }),
      );
    });

    it('is a no-op — and signs nobody out — when the role is unchanged', async () => {
      // Re-PUTting the same role must not evict. A console polling the member list would otherwise
      // be a logout mechanism.
      const { service, identity } = makeService(auth, [
        TWO_MEMBERS,
        [
          {
            user_id: 'u-operator',
            email: 'op@x.test',
            role: 'MERCHANT_OPERATOR',
            merchant_id: MERCHANT,
            disabled_at: null,
          },
        ],
      ]);

      await service.changeRole({
        merchantId: MERCHANT,
        userId: 'u-operator',
        role: 'MERCHANT_OPERATOR',
        changedBy: 'u-owner',
      });

      expect(auth.revokeSessionsForUser).not.toHaveBeenCalled();
      expect(identity.query).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE identity.user_merchants'),
        expect.anything(),
      );
    });

    it('refuses to demote the last owner even with a valid new role', async () => {
      const { service } = makeService(auth, [TWO_MEMBERS]);

      await expect(
        service.changeRole({
          merchantId: MERCHANT,
          userId: 'u-owner',
          role: 'MERCHANT_OPERATOR',
          changedBy: 'u-operator',
        }),
      ).rejects.toThrow(/last owner/);
      expect(auth.revokeSessionsForUser).not.toHaveBeenCalled();
    });

    it('refuses to enrol somebody as a platform role before writing anything', async () => {
      // The escalation rule, checked before the INSERT rather than after. A refusal that has already
      // written the membership is not a refusal.
      const { service, identity } = makeService(auth, []);

      await expect(
        service.invite({
          merchantId: MERCHANT,
          email: 'x@y.test',
          role: 'PLATFORM_ADMIN',
          invitedBy: 'u-owner',
        }),
      ).rejects.toThrow(/may only grant/);

      expect(identity.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO identity.user_merchants'),
        expect.anything(),
      );
    });
  });

  describe('inviting', () => {
    it('refuses a disabled account rather than reactivating it', async () => {
      // An invite is not the decision to re-enable somebody, and treating it as one would grant
      // access nobody granted.
      const { service } = makeService(auth, [
        [{ id: 'u-1', email: 'x@y.test', disabled_at: new Date() }],
      ]);

      await expect(
        service.invite({
          merchantId: MERCHANT,
          email: 'x@y.test',
          role: 'MERCHANT_OPERATOR',
          invitedBy: 'u-owner',
        }),
      ).rejects.toThrow(MemberDisabledError);
    });

    it('refuses somebody who is already a member', async () => {
      const { service } = makeService(auth, [
        [{ id: 'u-1', email: 'x@y.test', disabled_at: null }],
        [{ '?column?': 1 }],
      ]);

      await expect(
        service.invite({
          merchantId: MERCHANT,
          email: 'x@y.test',
          role: 'MERCHANT_OPERATOR',
          invitedBy: 'u-owner',
        }),
      ).rejects.toThrow(MembershipExistsError);
    });

    it('creates the person when the email has no account yet', async () => {
      const { service, identity } = makeService(auth, [
        [], // no existing user
        [{ id: 'u-new' }], // INSERT ... RETURNING id
        [], // no existing membership
        [
          {
            user_id: 'u-new',
            email: 'x@y.test',
            role: 'MERCHANT_OPERATOR',
            merchant_id: MERCHANT,
            disabled_at: null,
          },
        ],
      ]);

      const view = await service.invite({
        merchantId: MERCHANT,
        email: 'x@y.test',
        role: 'MERCHANT_OPERATOR',
        invitedBy: 'u-owner',
      });

      expect(view.userId).toBe('u-new');
      expect(identity.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO identity.users'),
        expect.arrayContaining(['x@y.test']),
      );
    });
  });
});
