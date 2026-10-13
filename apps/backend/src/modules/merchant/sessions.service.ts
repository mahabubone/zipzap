/**
 * MerchantAuthService — the human credential contract. Owns `merchant.sessions`.
 *
 * Token: 32 random bytes, base64url, presented once at login. Only its SHA-256
 * is stored — the raw token is never retrievable. Session expiry is absolute;
 * a revoked or expired session fails the same way a wrong password does, by a
 * single AuthenticationRequiredError with no distinguishing detail.
 *
 * ## Why this asks identity who the user is
 *
 * A session authenticates a PERSON (`sessions.user_id`), and the person — email, password hash,
 * memberships — is identity's data. So this service reads `merchant.sessions` and nothing else, and
 * calls `UserService` for the credential. Same seam as `FindCredentialService` (identity →
 * merchant), pointed the other way; that is what lets one login hold several memberships.
 *
 * Login is audited on BOTH outcomes, and the failure row is the one that matters: a credential
 * stuffing run is invisible except as a row with no actor and an ip. It is written after the KDF
 * runs, so its cost is noise against the ~70 ms scrypt — an unauthenticated attacker cannot make
 * the audit write the expensive part.
 */

import { Injectable, Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { verifySecret } from '../../common/secret.ts';
import { AuditService } from '../system/audit.service.ts';
import { canAcceptShipments } from './rules/merchant.ts';
import type { MerchantStatus } from './rules/merchant.ts';
import { UserService } from '../identity/user.service.ts';
import { resolveActiveMerchant, roleForMerchant } from '../identity/rules/users.ts';
import { SESSION_ABSOLUTE_TTL_HOURS, SESSION_IDLE_TTL_HOURS } from '../identity/session-cookie.ts';
import type { FoundUser } from '../identity/user.service.ts';

export interface SessionRow {
  readonly id: string;
  /** The ACTIVE business — the one this token acts inside. */
  readonly merchantId: string;
  readonly userId: string;
  readonly merchantStatus: MerchantStatus;
  readonly rateLimitPerMin: number | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
  readonly merchantId: string;
  /** Every business this login may act inside, so a client can offer the choice at next login. */
  readonly merchantIds: readonly string[];
  readonly userId: string;
}

/** Provenance for the audit row. Never carries the password — see audit.writer's denylist. */
export interface LoginAttempt {
  readonly email: string;
  readonly password: string;
  /** The business to act inside. Must be one the user holds; refused otherwise, never ignored. */
  readonly merchantId?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
}

@Injectable()
export class MerchantAuthService {
  constructor(
    @InjectDataSource('merchant') private readonly merchant: DataSource,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(UserService) private readonly users: UserService,
  ) {}

  async loginWithPassword(attempt: LoginAttempt): Promise<IssuedSession | null> {
    const user = await this.users.findByEmail(attempt.email);

    // Same failure for unknown email, disabled user and wrong password — never a signal about
    // which part failed. The password is NOT optional on identity.users (NOT NULL), so there is no
    // "no password set" case here any more; it lived on merchant.merchants and is gone.
    if (!user || user.disabledAt !== null) {
      await this.audit.record(this.failedAttempt(attempt, !user ? 'unknown_email' : 'disabled'));
      return null;
    }
    if (!(await verifySecret(attempt.password, user.passwordHash))) {
      await this.audit.record(this.failedAttempt(attempt, 'bad_password'));
      return null;
    }

    // Which business this session acts inside, and the role held THERE. Both come from the
    // memberships, never from the request alone: a role per user cannot express "operator at one
    // store, owner at another", which is the ordinary case for anyone running two shops.
    const activeMerchantId = this.activeMerchantFor(user, attempt.merchantId ?? null);
    if (activeMerchantId === null) {
      await this.audit.record(this.failedAttempt(attempt, 'no_membership'));
      return null;
    }
    const role = roleForMerchant(user, activeMerchantId);

    const status = await this.merchantStatus(activeMerchantId);
    // Checked AFTER the password, so an inactive business is indistinguishable from a wrong one.
    if (status === null || !canAcceptShipments(status)) {
      await this.audit.record(this.failedAttempt(attempt, 'merchant_not_active'));
      return null;
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_IDLE_TTL_HOURS * 60 * 60 * 1000);
    const sessionId = randomUUID();

    // No `role` column: migration 0036 dropped it, because the membership's role is the source of
    // truth and a second copy on the session could disagree with it unnoticed. The role is recorded
    // in the audit row instead — as history of what was issued, not as live state.
    await this.merchant.query(
      `INSERT INTO merchant.sessions (id, merchant_id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, activeMerchantId, user.userId, sha256(token), expiresAt],
    );

    const merchantIds = user.memberships.map((m) => m.merchantId);
    await this.audit.record({
      actorType: 'human',
      actorId: user.userId,
      merchantId: activeMerchantId,
      action: 'auth.login.succeeded',
      targetType: 'session',
      targetId: sessionId,
      requestId: attempt.requestId ?? null,
      ip: attempt.ip ?? null,
      userAgent: attempt.userAgent ?? null,
      // The role issued, not the scopes: scopes are derivable from the role, this is history.
      metadata: { role, expiresAt: expiresAt.toISOString(), merchantIds },
    });

    return { token, expiresAt, merchantId: activeMerchantId, merchantIds, userId: user.userId };
  }

  async revokeSession(
    sessionId: string,
    context?: { merchantId?: string | null; ip?: string | null; requestId?: string | null },
  ): Promise<void> {
    await this.merchant.query(
      `UPDATE merchant.sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
    await this.audit.record({
      actorType: 'human',
      actorId: sessionId,
      merchantId: context?.merchantId ?? null,
      action: 'auth.session.revoked',
      targetType: 'session',
      targetId: sessionId,
      requestId: context?.requestId ?? null,
      ip: context?.ip ?? null,
    });
  }

  /**
   * A failed login has no actor and no trustworthy merchant: the email is unauthenticated input,
   * so recording it against a merchant would let anyone write rows into a competitor's trail.
   * The reason is recorded instead — five distinct reasons, so "is this an enumeration attempt"
   * is answerable from the trail alone.
   */
  private failedAttempt(attempt: LoginAttempt, reason: string) {
    return {
      actorType: 'human' as const,
      actorId: null,
      merchantId: null,
      action: 'auth.login.failed',
      requestId: attempt.requestId ?? null,
      ip: attempt.ip ?? null,
      userAgent: attempt.userAgent ?? null,
      metadata: { reason },
    };
  }

  /**
   * Slides the session forward, within the ceiling.
   *
   * Idle expiry protects an unattended machine; absolute expiry is what guarantees a stolen
   * session eventually stops working even if the thief keeps it warm. So renewal extends by the
   * idle window but never past `created_at + absolute`, and it is skipped entirely once more than
   * half the window remains — a write on every request would put a database row update in the
   * hot path of all 83 operations to save a handful that are close enough to expiry to matter.
   *
   * Called only when `authenticateToken` reported the threshold was crossed, so the common case
   * is zero writes.
   */
  private async renewSessionIfDue(row: SessionRow, nowMs: number): Promise<Date | null> {
    const idleMs = SESSION_IDLE_TTL_HOURS * 60 * 60 * 1000;
    const remaining = row.expiresAt.getTime() - nowMs;
    if (remaining > idleMs / 2) return null;

    const next = Math.min(
      nowMs + idleMs,
      row.createdAt.getTime() + SESSION_ABSOLUTE_TTL_HOURS * 60 * 60 * 1000,
    );
    await this.merchant.query(
      `UPDATE merchant.sessions
          SET expires_at = $2
        WHERE id = $1 AND revoked_at IS NULL AND expires_at < $2`,
      [row.id, new Date(next)],
    );
    return new Date(next);
  }

  async authenticateToken(token: string): Promise<SessionRow | null> {
    const rows = await this.merchant.query(
      `SELECT s.id, s.merchant_id, s.user_id, s.revoked_at, s.expires_at, s.created_at,
               m.status, m.rate_limit_per_min
          FROM merchant.sessions s
          JOIN merchant.merchants m ON m.id = s.merchant_id
         WHERE s.token_hash = $1`,
      [sha256(token)],
    );
    const row = rows[0] as
      | {
          id: string;
          merchant_id: string;
          user_id: string;
          revoked_at: Date | null;
          expires_at: Date | string;
          created_at: Date | string;
          status: MerchantStatus;
          rate_limit_per_min: number | null;
        }
      | undefined;
    if (!row) return null;
    if (row.revoked_at !== null) return null;
    if (!canAcceptShipments(row.status)) return null;

    const nowMs = Date.now();
    const session: SessionRow = {
      id: row.id,
      merchantId: row.merchant_id,
      userId: row.user_id,
      merchantStatus: row.status,
      rateLimitPerMin: row.rate_limit_per_min,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    };
    if (session.expiresAt.getTime() < nowMs) return null;

    await this.renewSessionIfDue(session, nowMs);
    return session;
  }

  /**
   * Revokes every session this user holds, so a privilege change takes effect everywhere at once.
   *
   * `docs/api/auth.md` has promised rotation on privilege change since it was written; nothing
   * called it. Role and membership are re-derived per request rather than copied onto the session
   * (migration 0036 dropped `sessions.role` for exactly that reason), so a changed role is already
   * honoured on the next request. What is NOT honoured without this is a *revoked membership* — a
   * hard revoke that left live sessions behind.
   *
   * Scoped by the session rows themselves, so a merchant revoking one person cannot touch another
   * tenant's sessions for the same user.
   */
  async revokeSessionsForUser(
    userId: string,
    context?: { merchantId?: string | null; ip?: string | null; requestId?: string | null },
  ): Promise<number> {
    const result = await this.merchant.query(
      `UPDATE merchant.sessions SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL
        RETURNING id`,
      [userId],
    );
    const revoked = result as Array<{ id: string }>;
    if (revoked.length === 0) return 0;

    await this.audit.record({
      actorType: 'human',
      actorId: userId,
      merchantId: context?.merchantId ?? null,
      action: 'auth.session.revoked_all',
      targetType: 'session',
      targetId: userId,
      requestId: context?.requestId ?? null,
      ip: context?.ip ?? null,
      metadata: { count: revoked.length, reason: context ? 'privilege_change' : 'manual' },
    });
    return revoked.length;
  }

  /**
   * Null rather than a throw: at this point in login every failure must collapse into the same
   * `AuthenticationRequiredError` the controller raises, and a membership the user does not hold is
   * one of those failures — not a distinguishable "forbidden".
   */
  private activeMerchantFor(user: FoundUser, requested: string | null): string | null {
    try {
      return resolveActiveMerchant(user, requested);
    } catch {
      return null;
    }
  }

  /** The merchant's own lifecycle state. Own schema; a plain lookup, not a JOIN across modules. */
  private async merchantStatus(merchantId: string): Promise<MerchantStatus | null> {
    const rows = await this.merchant.query(`SELECT status FROM merchant.merchants WHERE id = $1`, [
      merchantId,
    ]);
    return (rows[0] as { status: MerchantStatus } | undefined)?.status ?? null;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
