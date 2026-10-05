/**
 * MiMSMSAdapter — the SMS rail, behind the NotificationChannel port.
 *
 * ALL provider vocabulary lives in this file and dies in this file. The domain
 * speaks E.164 and `Delivered`; MiMSMS speaks `8801XXXXXXXXX` and DLR names with
 * carrier retry policies. Nothing outside this directory may contain
 * `mobileNumber`, `transactionType`, `trackingId`, or DLR names. The boundary
 * checker enforces it.
 *
 * Verified against the fake in infra/fakes (Bulk SMS API v2.1, 2026-10-02):
 *  - auth is apiKey + userName IN THE BODY, never a header. Demo credentials
 *    are the published ones.
 *  - `transactionType: "T"` allows exactly ONE recipient and ignores DND. Parcel
 *    notifications are always T — batching them into P would DND-delay them.
 *  - the response envelope `{ statusCode, status, trxnId, message, data[] }` uses
 *    a STRING statusCode. data[] contents are inferred, not verified.
 *  - DLR via DlrApi by trackingId: `dlrName` + carrier `retryPolicy`. Only
 *    policy 0 dead-letters — see rules/channel.ts.
 */

import type { OutboundSms, SmsDlrName, SmsReceipt } from '../rules/channel.ts';

export interface MiMSMSConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly userName: string;
  readonly senderName: string;
}

interface MiMSMSEnvelope {
  readonly statusCode: string;
  readonly status: string;
  readonly trxnId: string;
  readonly message: string;
  readonly data: Array<{
    readonly mobileNumber?: string;
    readonly trackingId?: string;
    readonly segments?: number;
    readonly status?: string;
  }>;
}

interface DlrEnvelope {
  readonly statusCode: string;
  readonly status: string;
  readonly trxnId: string;
  readonly message: string;
  readonly data: Array<{
    readonly trackingId: string;
    readonly mobileNumber: string;
    readonly segments: number;
    readonly status: string;
    readonly dlrName: string | null;
    readonly retryPolicy: number | null;
  }>;
}

export class MiMSMSError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MiMSMSError';
  }
}

export interface SmsChannel {
  readonly name: 'sms';
  send(message: OutboundSms): Promise<SmsReceipt>;
  deliveryReport(trackingId: string): Promise<{
    dlrName: SmsDlrName | null;
    retryPolicy: number | null;
    delivered: boolean;
  }>;
}

export class MiMSMSAdapter implements SmsChannel {
  readonly name = 'sms' as const;

  constructor(private readonly config: MiMSMSConfig) {}

  async send(message: OutboundSms): Promise<SmsReceipt> {
    const mobileNumber = toProviderMsisdn(message.recipientE164);
    // The domain decides transactional-vs-promotional; the provider token "T"/"P"
    // is mapped here, at the wire, and nowhere else.
    const transactionType = message.kind === 'transactional' ? 'T' : 'P';
    const response = await fetch(`${this.config.baseUrl}/api/V2/SMS`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: this.config.apiKey,
        userName: this.config.userName,
        senderName: this.config.senderName,
        mobileNumber,
        message: message.body,
        transactionType,
      }),
    });
    if (!response.ok) {
      throw new MiMSMSError(`MiMSMS send HTTP ${response.status} for ${mobileNumber}.`);
    }
    const body = (await response.json()) as MiMSMSEnvelope;
    if (body.statusCode !== '200') {
      throw new MiMSMSError(
        `MiMSMS rejected ${mobileNumber}: [${body.statusCode}] ${body.message}`,
      );
    }
    const row = body.data[0];
    if (!row?.trackingId) {
      throw new MiMSMSError(`MiMSMS send for ${mobileNumber} returned no trackingId.`);
    }
    return {
      providerReference: body.trxnId,
      trackingId: row.trackingId,
      segments: row.segments ?? 1,
    };
  }

  async deliveryReport(trackingId: string): Promise<{
    dlrName: SmsDlrName | null;
    retryPolicy: number | null;
    delivered: boolean;
  }> {
    const response = await fetch(`${this.config.baseUrl}/api/V2/DlrApi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: this.config.apiKey,
        userName: this.config.userName,
        trackingId,
      }),
    });
    if (!response.ok) {
      throw new MiMSMSError(`MiMSMS DlrApi HTTP ${response.status} for ${trackingId}.`);
    }
    const body = (await response.json()) as DlrEnvelope;
    if (body.statusCode !== '200') {
      throw new MiMSMSError(
        `MiMSMS DlrApi failed for ${trackingId}: [${body.statusCode}] ${body.message}`,
      );
    }
    const row = body.data[0];
    if (!row) {
      throw new MiMSMSError(`MiMSMS DlrApi returned no report for ${trackingId}.`);
    }
    return {
      dlrName: row.dlrName as SmsDlrName | null,
      retryPolicy: row.retryPolicy,
      delivered: row.dlrName === 'Delivered',
    };
  }
}

/**
 * +8801844909020 -> 8801844909020. MiMSMS rejects the plus sign — and the "always
 * normalise to E.164" reflex is wrong for this provider. The conversion belongs
 * here, not in the domain, for exactly the same reason the money conversion does.
 */
export function toProviderMsisdn(stored: string): string {
  const stripped = stored.replace(/^\+/, '');
  if (!/^8801[3-9]\d{8}$/.test(stripped)) {
    throw new MiMSMSError(
      `Refusing to send to "${stored}": MiMSMS expects 8801XXXXXXXXX, no plus, no leading zero.`,
    );
  }
  return stripped;
}
