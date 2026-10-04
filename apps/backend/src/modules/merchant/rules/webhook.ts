/**
 * Webhook rules. Framework-free: no @nestjs, no typeorm, no class-validator.
 *
 * Two pure decisions live here:
 *
 * 1. Signing: HMAC-SHA256 over `{timestamp}.{raw_body}`, hex, compared in constant
 *    time. The RAW body — re-serialising parsed JSON changes key order and breaks
 *    verification, which is the most common webhook integration bug.
 * 2. Retry: the 1m → 5m → 15m → 1h → 6h → 24h ladder as data, plus the 4xx rule.
 *    A 4xx (other than 429) is permanent — retrying a 400 forever is a DoS tool
 *    against our own infrastructure. 429 honours Retry-After.
 *
 * Wire event names are the public contract: dotted, lowercase, past tense —
 * `shipment.delivered`, not `ShipmentDelivered`. Internal names stay internal.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Internal outbox type -> public wire name. New events add a row here, nowhere else. */
export const WEBHOOK_EVENTS = {
  ShipmentCreated: 'shipment.created',
  DeliveryOutForDelivery: 'shipment.out_for_delivery',
  DeliveryCompleted: 'shipment.delivered',
  CODCollected: 'cod.collected',
  SettlementApproved: 'settlement.created',
  SettlementCompleted: 'settlement.completed',
} as const satisfies Record<string, string>;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[keyof typeof WEBHOOK_EVENTS];

export function wireEvent(internalType: string): WebhookEvent | null {
  return (WEBHOOK_EVENTS as Record<string, WebhookEvent>)[internalType] ?? null;
}

/** Backoff delays in milliseconds: 1m → 5m → 15m → 1h → 6h → 24h. */
export const RETRY_LADDER_MS = [
  60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000,
] as const;

/** Delay before attempt n (1-based). Past the ladder end: terminal, no more retries. */
export function delayBeforeAttempt(attempt: number): number | null {
  if (attempt < 1 || attempt > RETRY_LADDER_MS.length) return null;
  return RETRY_LADDER_MS[attempt - 1]!;
}

/** True when this failure deserves another attempt. 4xx (except 429) is permanent. */
export function isRetryable(statusCode: number | null): boolean {
  // Timeout / connection refused: no status at all, always retry.
  if (statusCode === null) return true;
  if (statusCode === 429) return true;
  if (statusCode >= 500) return true;
  return false;
}

export function signPayload(secret: string, timestampSeconds: number, rawBody: string): string {
  return createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`, 'utf8')
    .digest('hex');
}

export interface WebhookSignature {
  readonly timestampSeconds: number;
  readonly signatureHex: string;
}

/**
 * Parse `t=1759387200,v1=<hex>`. Returns null when malformed — a malformed header
 * is a rejection, not an exception.
 */
export function parseSignatureHeader(header: string | undefined): WebhookSignature | null {
  if (!header) return null;
  const match = /^t=(\d+),v1=([0-9a-fA-F]+)$/.exec(header.trim());
  if (!match) return null;
  return { timestampSeconds: Number(match[1]), signatureHex: match[2]!.toLowerCase() };
}

export const TIMESTAMP_TOLERANCE_SECONDS = 300;

/** Constant-time compare against the expected signature, with replay-window check. */
export function verifySignature(
  secret: string,
  header: string | undefined,
  rawBody: string,
  nowSeconds: number = Math.trunc(Date.now() / 1000),
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(nowSeconds - parsed.timestampSeconds) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const expected = signPayload(secret, parsed.timestampSeconds, rawBody);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parsed.signatureHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
