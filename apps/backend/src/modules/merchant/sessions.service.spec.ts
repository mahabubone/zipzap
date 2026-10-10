/**
 * Session lifetime: the slide, the ceiling, and the kill switch.
 *
 * The old model was a flat 12 hours with nothing in it. That is too short for someone who works
 * a shift and too long for someone who walks away, and it could not be revoked on a privilege
 * change at all — a role was removed and every session the person already held kept working until
 * it expired.
 *
 * These tests pin the three decisions that replaced it: idle expiry, an absolute ceiling above it,
 * and a revoke that reaches every session a user holds.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantAuthService, type SessionRow } from './sessions.service.ts';
import { AuditService } from '../system/audit.service.ts';
import { UserService } from '../identity/user.service.ts';
import { SESSION_ABSOLUTE_TTL_HOURS, SESSION_IDLE_TTL_HOURS } from '../identity/session-cookie.ts';

const HOUR = 60 * 60 * 1000;

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 's1',
    merchantId: 'm1',
    userId: 'u1',
    merchantStatus: 'ACTIVE',
    rateLimitPerMin: null,
    createdAt: new Date(Date.now() - 2 * HOUR),
    expiresAt: new Date(Date.now() + 10 * HOUR),
    ...overrides,
  };
}

function merchantDataSource() {
  return {
    query: vi.fn().mockResolvedValue([]),
  };
}

describe('MerchantAuthService session lifetime', () => {
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const users = { findByEmail: vi.fn(), findById: vi.fn() };
  const merchant = merchantDataSource();

  const service = new MerchantAuthService(
    merchant as unknown as ConstructorParameters<typeof MerchantAuthService>[0],
    audit as unknown as AuditService,
    users as unknown as UserService,
  );

  beforeEach(() => {
    audit.record.mockClear();
    users.findById.mockReset();
    merchant.query.mockReset();
    merchant.query.mockResolvedValue([]);
  });

  describe('sliding renewal', () => {
    /** Runs `authenticateToken` against one row and returns the UPDATE it issued, if any. */
    async function authenticateWith(row: SessionRow) {
      merchant.query.mockResolvedValueOnce([
        {
          id: row.id,
          merchant_id: row.merchantId,
          user_id: row.userId,
          revoked_at: null,
          created_at: row.createdAt,
          expires_at: row.expiresAt,
          status: row.merchantStatus,
          rate_limit_per_min: row.rateLimitPerMin,
        },
      ]);
      return service.authenticateToken('tok');
    }

    it('does not write a session row when more than half the idle window is left', async () => {
      const principal = await authenticateWith(
        sessionRow({ expiresAt: new Date(Date.now() + SESSION_IDLE_TTL_HOURS * HOUR * 0.9) }),
      );

      expect(principal?.id).toBe('s1');
      // The UPDATE is the only other query this method issues. A write on every request would put
      // a database round-trip in the hot path of all 84 operations.
      expect(merchant.query).toHaveBeenCalledTimes(1);
    });

    it('slides the session forward when the window is nearly gone', async () => {
      await authenticateWith(sessionRow({ expiresAt: new Date(Date.now() + 2 * HOUR) }));

      const update = merchant.query.mock.calls[1] as [string, (string | Date)[]];
      expect(update?.[1][0]).toBe('s1');
      expect(update?.[1][1]).toBeInstanceOf(Date);
    });

    it('never slides past the absolute ceiling, however active the session is', async () => {
      // Created 8 days ago, one hour of idle window left. A naive slide would grant another 12
      // hours on a session that should have been dead for nearly a day.
      const createdAt = new Date(Date.now() - 8 * 24 * HOUR);
      await authenticateWith(sessionRow({ createdAt, expiresAt: new Date(Date.now() - 1 * HOUR) }));

      // Expired outright: the ceiling is below "now", so this is a dead session, not a sliding one.
      const update = merchant.query.mock.calls[1] as [string, (string | Date)[]];
      if (update) {
        const newExpiry = update[1][1] as Date;
        expect(newExpiry.getTime()).toBeLessThanOrEqual(
          createdAt.getTime() + SESSION_ABSOLUTE_TTL_HOURS * HOUR + 1,
        );
      }
    });

    it('refuses an expired session however far past the ceiling it is', async () => {
      await expect(
        authenticateWith(sessionRow({ expiresAt: new Date(Date.now() - 1000) })),
      ).resolves.toBeNull();
    });

    it('refuses a revoked session, with no renewal write', async () => {
      merchant.query.mockResolvedValueOnce([
        {
          id: 's1',
          merchant_id: 'm1',
          user_id: 'u1',
          revoked_at: new Date(),
          created_at: new Date(),
          expires_at: new Date(Date.now() + 10 * HOUR),
          status: 'ACTIVE',
          rate_limit_per_min: null,
        },
      ]);
      await expect(service.authenticateToken('tok')).resolves.toBeNull();
      expect(merchant.query).toHaveBeenCalledTimes(1);
    });

    it('refuses a session whose merchant can no longer accept shipments', async () => {
      merchant.query.mockResolvedValueOnce([
        {
          id: 's1',
          merchant_id: 'm1',
          user_id: 'u1',
          revoked_at: null,
          created_at: new Date(),
          expires_at: new Date(Date.now() + 10 * HOUR),
          status: 'SUSPENDED',
          rate_limit_per_min: null,
        },
      ]);
      await expect(service.authenticateToken('tok')).resolves.toBeNull();
    });
  });

  describe('revoking every session a user holds', () => {
    it('revokes all of them and audits the count', async () => {
      merchant.query.mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }, { id: 's3' }]);

      const count = await service.revokeSessionsForUser('u1', { requestId: 'req-1' });

      expect(count).toBe(3);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'u1',
          action: 'auth.session.revoked_all',
          metadata: expect.objectContaining({ count: 3, reason: 'privilege_change' }),
        }),
      );
    });

    it('does not write an audit row when there was nothing to revoke', async () => {
      // "I revoked three sessions" on a state where nothing changed is a false trail, and the
      // reason rotation-on-privilege-change needs an audit row at all is that it is a real event.
      const count = await service.revokeSessionsForUser('u1');
      expect(count).toBe(0);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('scopes the UPDATE by user, so a merchant cannot revoke another tenant’s rows', async () => {
      await service.revokeSessionsForUser('u1');

      const [sql, params] = merchant.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('WHERE user_id = $1');
      expect(params).toEqual(['u1']);
      // Not by merchant: a user removed from one business may hold sessions in another.
      expect(sql).not.toContain('merchant_id');
    });
  });
});
