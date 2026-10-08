/**
 * Writing to `system.audit_events`.
 *
 * `record` takes an optional EntityManager, and the rule is the same one the outbox follows: pass
 * the manager of the transaction that made the change, or accept that the row and the change are
 * not atomic. A login has no business transaction, so it goes standalone — that is correct, not a
 * shortcut.
 *
 * **`metadata` is checked, not trusted.** AGENTS.md rule 10 says never log a password, token, API
 * secret or webhook signing secret, and a rule enforced only by a comment is a wish. An audit row
 * outlives every log retention policy, so it is the *last* place a secret should land rather than
 * the first. `assertNoSecrets` walks the object and throws on a denylisted key at any depth.
 *
 * The throw is deliberate over silently redacting. A caller that tries to record a password has a
 * bug, and a redacted audit row hides it; a 500 tells them immediately. It cannot lose data,
 * because the caller's own write is what failed.
 *
 * `ponytail:` key-name matching, not value inspection. A caller can smuggle a secret into a value
 * under an innocent key (`{note: "sk_live_…"}`) and this will not catch it. Value scanning would
 * also false-positive on a legitimate metadata value that happens to look like a token, which is a
 * worse failure in an audit path. Contract: callers pass identifiers and counts, never prose.
 */

import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';

/** Lowercase. Matched against the key with non-alphanumerics stripped, so `api_secret` matches too. */
const FORBIDDEN_KEYS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'signingsecret',
  'privatekey',
  'bearer',
  'hash',
  'passwordhash',
  'secrethash',
  'credential',
]);

export type AuditActorType = 'human' | 'machine' | 'system';

export interface AuditEntry {
  readonly actorType: AuditActorType;
  /** The authenticated subject. Null for a failed login — nobody authenticated. */
  readonly actorId?: string | null;
  /** Tenant scope, so a merchant-scoped read is a WHERE and not a JOIN. */
  readonly merchantId?: string | null;
  /** Past-tense dotted verb: `auth.login.succeeded`, `credential.revoked`. */
  readonly action: string;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly requestId?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  /** Ids, counts and states. Never a secret, never prose. Checked at runtime. */
  readonly metadata?: Record<string, unknown>;
}

export class SecretInAuditMetadataError extends Error {
  constructor(readonly path: string) {
    super(`Refusing to write a secret to system.audit_events at metadata.${path}`);
    this.name = 'SecretInAuditMetadataError';
  }
}

function normaliseKey(key: string): string {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

/** Throws on the first denylisted key found at any depth. */
export function assertNoSecrets(value: unknown, path = 'root'): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoSecrets(item, `${path}[${i}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(normaliseKey(key)))
      throw new SecretInAuditMetadataError(`${path}.${key}`);
    assertNoSecrets(nested, `${path}.${key}`);
  }
}

export async function record(manager: EntityManager, entry: AuditEntry): Promise<void> {
  assertNoSecrets(entry.metadata ?? {});

  await manager.query(
    `INSERT INTO system.audit_events
       (id, actor_type, actor_id, merchant_id, action, target_type, target_id,
        request_id, ip, user_agent, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      randomUUID(),
      entry.actorType,
      entry.actorId ?? null,
      entry.merchantId ?? null,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.requestId ?? null,
      entry.ip ?? null,
      entry.userAgent ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}
