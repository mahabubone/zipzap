/**
 * Notification channel rules. Framework-free: no @nestjs, no typeorm, no class-validator.
 *
 * Two pure decisions live here:
 *
 * 1. Dead-letter: ONLY the carrier's retry policy 0 is permanent. `Absent subscriber
 *    for SM` carries policy 3 — the handset was off and the carrier retries it
 *    itself. Dead-lettering on first failure discards messages about to be
 *    delivered. Our ladder retries on top for when the carrier has exhausted ITS
 *    retries, not as a replacement for them.
 * 2. Idempotency: every send keys on (eventId, channel, recipient). A customer
 *    receiving the same SMS twice is a real, visible failure — worse than late.
 */

export type NotificationChannel = 'sms' | 'email' | 'push';

export type SmsDlrName =
  | 'Delivered'
  | 'Absent subscriber for SM'
  | 'Subscriber Busy'
  | 'System failure'
  | 'Undelivered'
  | 'Barred subscriber'
  | 'Illegal subscriber';

/** Carrier retry policy per DLR name, from the published MiMSMS table. */
export const CARRIER_RETRY_POLICY: Record<SmsDlrName, number> = {
  Delivered: 0,
  'Absent subscriber for SM': 3,
  'Subscriber Busy': 3,
  'System failure': 3,
  Undelivered: 0,
  'Barred subscriber': 0,
  'Illegal subscriber': 0,
};

/**
 * True only when the carrier will NOT retry on its own. Policy 0 + not delivered
 * is the single permanent-failure signal; everything else deserves our ladder.
 */
export function isCarrierTerminal(dlrName: SmsDlrName): boolean {
  if (dlrName === 'Delivered') return true;
  return CARRIER_RETRY_POLICY[dlrName] === 0;
}

/** Dedupe key: one customer, one event, one channel — never twice. */
export function dedupeKey(
  eventId: string,
  channel: NotificationChannel,
  recipient: string,
): string {
  return `${eventId}:${channel}:${recipient}`;
}

/** Outbound SMS shape. The adapter formats the number; the domain never does. */
export interface OutboundSms {
  /** E.164 as stored (+8801XXXXXXXXX). The adapter strips the plus for MiMSMS. */
  readonly recipientE164: string;
  readonly body: string;
  /**
   * Transactional (one recipient, ignores DND) vs promotional. Parcel events are
   * always transactional. The domain names the PRODUCT decision; the adapter maps
   * it to the provider's "T"/"P" token at the wire — see provider-adapters.md.
   */
  readonly kind: 'transactional' | 'promotional';
}

export interface SmsReceipt {
  readonly providerReference: string;
  readonly trackingId: string;
  readonly segments: number;
}
