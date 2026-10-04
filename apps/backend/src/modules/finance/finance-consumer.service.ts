/**
 * FinanceConsumer — turns COD facts from other modules into money, exactly once.
 *
 * COD owns the cash record; finance owns the money movement. The boundary is deliberate — a COD
 * record and a ledger entry are different facts, and conflating them makes reconciliation
 * impossible. So this consumer subscribes to CODCollected and CODPartialCollection and posts
 * exactly one COD_COLLECTED entry per record, guarded by a reference check that makes replays
 * provably harmless:
 *
 *   - an entry already referencing this COD record id -> skip, it is a replay
 *   - otherwise -> post exactly one entry for the collected amount
 *
 * The guard is a query, not a consumed_events row, because the consumer contract here is
 * idempotence-by-reference: two different deliveries of the same event must converge on one
 * entry, and the entry itself is the proof. consumed_events still records the claim; the
 * reference check is what makes the claim cheap to verify months later.
 *
 * PARTIAL_COLLECTION posts the collected amount, not the expected amount. The shortfall is not
 * invented, not rounded, and not written as an adjustment — it simply never becomes an entry,
 * and the merchant is settled on what arrived. See docs/domains/cod.md.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

export const FINANCE_CONSUMER = 'finance';

interface CodCollectedPayload {
  readonly shipmentId: string;
  readonly merchantId: string;
  readonly currency: string;
  readonly expectedMinor: number;
  readonly collectedMinor: number;
}

interface CodEnvelope {
  readonly id: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly data: CodCollectedPayload;
}

@Injectable()
export class FinanceConsumer {
  private readonly logger = new Logger(FinanceConsumer.name);

  constructor(@InjectDataSource('finance') private readonly finance: DataSource) {}

  async handle(message: {
    subject: string;
    payload: Uint8Array;
  }): Promise<'processed' | 'duplicate' | 'ignored' | 'malformed'> {
    let envelope: CodEnvelope;
    try {
      envelope = JSON.parse(Buffer.from(message.payload).toString('utf8')) as CodEnvelope;
    } catch {
      this.logger.error({ subject: message.subject }, 'unparseable event payload');
      return 'malformed';
    }

    if (envelope.type !== 'CODCollected' && envelope.type !== 'CODPartialCollection') {
      return 'ignored';
    }

    return this.finance.transaction(async (manager) => {
      const claimed = await manager.query(
        `INSERT INTO system.consumed_events (consumer, event_id)
         VALUES ($1, $2)
         ON CONFLICT (consumer, event_id) DO NOTHING
         RETURNING event_id`,
        [FINANCE_CONSUMER, envelope.id],
      );
      if (claimed.length === 0) return 'duplicate';

      // Reference check: one entry per COD record, regardless of how many times this runs.
      const existing = await manager.query(
        `SELECT id FROM finance.ledger_entries
          WHERE reference_type = 'COD_RECORD' AND reference_id = $1`,
        [envelope.aggregateId],
      );
      if (existing.length > 0) return 'duplicate';

      await manager.query(
        `INSERT INTO finance.ledger_entries
           (id, merchant_id, entry_type, direction, amount_minor, currency,
            reference_type, reference_id, memo, occurred_at)
         VALUES ($1, $2, 'COD_COLLECTED', 1, $3, $4,
                 'COD_RECORD', $5, $6, $7)`,
        [
          randomUUID(),
          envelope.data.merchantId,
          envelope.data.collectedMinor,
          envelope.data.currency,
          envelope.aggregateId,
          'COD collected for shipment ' + envelope.data.shipmentId,
          envelope.occurredAt,
        ],
      );

      return 'processed';
    });
  }
}
