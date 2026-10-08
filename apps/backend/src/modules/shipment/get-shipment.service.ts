/**
 * GetShipmentService — one parcel, own merchant only, and an audit row because the response
 * contains a person's contact details.
 *
 * Two things live here that used to live in the controller, and both belong here:
 *
 *   - **the query.** A controller that runs SQL is not thin, and this one was reaching for a
 *     DataSource directly. See AGENTS.md: validate → one service call → return.
 *   - **the read audit.** `senderName`, `senderPhone`, `recipientName` and `recipientPhone` are
 *     the most sensitive rows in the database (docs/domains/customer.md). Restricted is not
 *     enough — a read has to leave a trail, or "who looked up this customer's phone number" is
 *     unanswerable after the fact.
 *
 * Why this endpoint and not others: it is the **only** read that returns PII.
 * `GET /v1/shipments` returns ids, status and money. The public tracker reads a projection that
 * selects `sequence, event_type, occurred_at` and cannot carry a phone number even by accident.
 * Auditing those would be volume for no investigative value — the public tracker is the highest-
 * traffic read in the system.
 *
 * `ponytail:` no pseudonymous index over the phone number (a keyed hash of the last four digits
 * would make "who searched for this number" answerable without storing the number again). The
 * shipment id already resolves to the recipient, so it buys nothing today. Add it when a support
 * workflow needs lookup-by-number across shipments.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { AuditService } from '../system/audit.service.ts';

export interface ShipmentDetail {
  readonly id: string;
  readonly trackingCode: string;
  readonly status: string;
  readonly merchantReference: string | null;
  readonly senderName: string;
  readonly senderPhone: string;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly parcelWeightGrams: number;
  readonly parcelDescription: string;
  readonly codAmountMinor: number;
  readonly codCurrency: string;
  readonly pricingVersion: number;
  readonly createdAt: string;
}

export interface ReadContext {
  readonly actorId: string | null;
  readonly actorType: 'human' | 'machine';
  readonly ip?: string | null;
  readonly requestId?: string | null;
}

/** The four columns that make this a PII read rather than a parcel read. */
export const PII_FIELDS = ['senderName', 'senderPhone', 'recipientName', 'recipientPhone'] as const;

@Injectable()
export class GetShipmentService {
  constructor(
    @InjectDataSource('shipment') private readonly shipments: DataSource,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async execute(merchantId: string, id: string, context?: ReadContext): Promise<ShipmentDetail> {
    const rows = await this.shipments.query(
      `SELECT id, tracking_code, status, merchant_reference, sender_name, sender_phone,
              recipient_name, recipient_phone, parcel_weight_grams, parcel_description,
              cod_amount_minor, cod_currency, pricing_version, created_at
         FROM shipment.shipments WHERE id = $1 AND merchant_id = $2`,
      [id, merchantId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    // 404, never 403: a 403 confirms the parcel exists, which is an enumeration oracle.
    if (!row) throw new ResourceNotFoundError('Shipment not found.');

    if (context) {
      // Only the fields' NAMES. The values are the sensitive part and must not be copied into a
      // second table that outlives every retention policy on the shipment itself.
      await this.audit.record({
        actorType: context.actorType,
        actorId: context.actorId,
        merchantId,
        action: 'customer.record_read',
        targetType: 'shipment',
        targetId: String(row.id),
        requestId: context.requestId ?? null,
        ip: context.ip ?? null,
        metadata: { fields: PII_FIELDS, fieldCount: PII_FIELDS.length },
      });
    }

    return {
      id: String(row.id),
      trackingCode: String(row.tracking_code),
      status: String(row.status),
      merchantReference: (row.merchant_reference as string | null) ?? null,
      senderName: String(row.sender_name),
      senderPhone: String(row.sender_phone),
      recipientName: String(row.recipient_name),
      recipientPhone: String(row.recipient_phone),
      parcelWeightGrams: Number(row.parcel_weight_grams),
      parcelDescription: String(row.parcel_description),
      codAmountMinor: Number(row.cod_amount_minor),
      codCurrency: String(row.cod_currency),
      pricingVersion: Number(row.pricing_version),
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }
}
