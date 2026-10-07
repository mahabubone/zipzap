/**
 * MerchantAuthService — the human credential contract. Owns `merchant.sessions`
 * and `merchants.password_hash`, both of which are merchant's tables.
 *
 * Token: 32 random bytes, base64url, presented once at login. Only its SHA-256
 * is stored — the raw token is never retrievable. Session expiry is absolute;
 * a revoked or expired session fails the same way a wrong password does, by a
 * single AuthenticationRequiredError with no distinguishing detail.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { verifySecret } from '../../common/secret.ts';
import { canAcceptShipments } from './rules/merchant.ts';
import type { MerchantStatus } from './rules/merchant.ts';

export interface SessionRow {
  readonly id: string;
  readonly merchantId: string;
  readonly merchantStatus: MerchantStatus;
  readonly rateLimitPerMin: number | null;
}

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: Date;
}

const SESSION_TTL_HOURS = 12;

@Injectable()
export class MerchantAuthService {
  constructor(@InjectDataSource('merchant') private readonly merchant: DataSource) {}

  async loginWithPassword(email: string, password: string): Promise<IssuedSession | null> {
    const rows = await this.merchant.query(
      `SELECT id, status, contact_email, password_hash
         FROM merchant.merchants
        WHERE contact_email = $1`,
      [email],
    );
    const row = rows[0] as { id: string; status: string; password_hash: string | null } | undefined;

    // Same failure for unknown email, no password set, and wrong password —
    // never a signal about which part failed.
    if (!row || row.password_hash === null) return null;
    if (!(await verifySecret(password, row.password_hash))) return null;

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

    await this.merchant.query(
      `INSERT INTO merchant.sessions (id, merchant_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), row.id, sha256(token), expiresAt],
    );

    return { token, expiresAt };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.merchant.query(
      `UPDATE merchant.sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
  }

  async authenticateToken(token: string): Promise<SessionRow | null> {
    const rows = await this.merchant.query(
      `SELECT s.id, s.merchant_id, s.revoked_at, s.expires_at, m.status, m.rate_limit_per_min
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
    };
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
