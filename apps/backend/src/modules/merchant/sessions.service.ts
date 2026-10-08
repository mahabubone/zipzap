/**
 * MerchantAuthService — the human credential contract. Owns `merchant.sessions`
 * and `merchants.password_hash`, both of which are merchant's tables.
 *
 * Token: 32 random bytes, base64url, presented once at login. Only its SHA-256
 * is stored — the raw token is never retrievable. Session expiry is absolute;
 * a revoked or expired session fails the same way a wrong password does, by a
 * single AuthenticationRequiredError with no distinguishing detail.
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

export interface SessionRow {
  readonly id: string;
  readonly merchantId: string;
  readonly merchantStatus: MerchantStatus;
  readonly rateLimitPerMin: number | null;
  /**
   * The role this session was ISSUED with, not the role the person holds now, kept as the opaque
   * string merchant.sessions stored at issue time. A privilege change revokes the session rather
   * than widening it, so a live token can never carry permissions its bearer did not have at
   * login. See migration 0034. Validating and mapping this value is identity's job.
   */
  readonly role: string;
}

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
}

/** Provenance for the audit row. Never carries the password — see audit.writer's denylist. */
export interface LoginAttempt {
  readonly email: string;
  readonly password: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
}

const SESSION_TTL_HOURS = 12;

@Injectable()
export class MerchantAuthService {
  constructor(
    @InjectDataSource('merchant') private readonly merchant: DataSource,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async loginWithPassword(attempt: LoginAttempt): Promise<IssuedSession | null> {
    const rows = await this.merchant.query(
      `SELECT id, status, contact_email, password_hash
         FROM merchant.merchants
        WHERE contact_email = $1`,
      [attempt.email],
    );
    const row = rows[0] as
      | { id: string; status: string; contact_email: string; password_hash: string | null }
      | undefined;

    // Same failure for unknown email, no password set, and wrong password —
    // never a signal about which part failed.
    if (!row || row.password_hash === null) {
      await this.audit.record(
        this.failedAttempt(attempt, row ? 'no_password_set' : 'unknown_email'),
      );
      return null;
    }
    if (!(await verifySecret(attempt.password, row.password_hash))) {
      await this.audit.record(this.failedAttempt(attempt, 'bad_password'));
      return null;
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);
    const sessionId = randomUUID();

    await this.merchant.query(
      `INSERT INTO merchant.sessions (id, merchant_id, token_hash, expires_at, role)
       VALUES ($1, $2, $3, $4, 'MERCHANT_OWNER')`,
      [sessionId, row.id, sha256(token), expiresAt],
    );

    await this.audit.record({
      actorType: 'human',
      actorId: sessionId,
      merchantId: row.id,
      action: 'auth.login.succeeded',
      targetType: 'session',
      targetId: sessionId,
      requestId: attempt.requestId ?? null,
      ip: attempt.ip ?? null,
      userAgent: attempt.userAgent ?? null,
      // The role issued, not the scopes: scopes are derivable from the role, this is history.
      metadata: { role: 'MERCHANT_OWNER', expiresAt: expiresAt.toISOString() },
    });

    return { token, expiresAt };
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
   * The reason is recorded instead — three distinct reasons, so "is this an enumeration attempt"
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

  async authenticateToken(token: string): Promise<SessionRow | null> {
    const rows = await this.merchant.query(
      `SELECT s.id, s.merchant_id, s.revoked_at, s.expires_at, s.role,
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
          revoked_at: Date | null;
          expires_at: Date;
          role: string;
          status: MerchantStatus;
          rate_limit_per_min: number | null;
        }
      | undefined;
    if (!row) return null;
    if (row.revoked_at !== null) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    if (!canAcceptShipments(row.status)) return null;

    return {
      id: row.id,
      merchantId: row.merchant_id,
      merchantStatus: row.status,
      rateLimitPerMin: row.rate_limit_per_min,
      role: row.role,
    };
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
