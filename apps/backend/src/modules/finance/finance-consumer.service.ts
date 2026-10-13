/**
 * FinanceConsumer — turns COD facts from other modules into money, exactly once.
 *
 * COD owns the cash record; finance owns the money movement. The boundary is deliberate — a COD
 * record and a ledger entry are different facts, and conflating them makes reconciliation
 * impossible. So this consumer subscribes to the COD collection events and posts exactly one
 * COD_COLLECTED entry per record, guarded by a reference check that makes replays provably
 * harmless:
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
 *
 * A MISMATCH is different, and the difference is the point. It posts the collected amount too —
 * because the cash is physically in a rider's pocket, and a ledger that omits it is not cautious,
 * it is wrong — and then `CODReconciled` posts the compensating ADJUSTMENT once a human has settled
 * on a figure. Both rows stay. That is the plan's "the ledger keeps both original rows" exit check,
 * and it is only satisfiable if the bad collection was recorded in the first place.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { reviewAdjustment } from '../cod/rules/cod.ts';

export const FINANCE_CONSUMER = 'finance';

/**
 * Outbox event types this consumer processes. Everything else is ignored, never fatal.
 *
 * `CODCollectionFailed` is here because of the exit check, and it is the least obvious entry in the
 * list. A mismatch used to post nothing at all, which read as tidiness and was the opposite: cash a
 * rider physically took simply did not exist anywhere. Money that changed hands is a fact about the
 * world; it gets a row whether or not we like the figure, and the dispute lives in a second row
 * rather than in the absence of one.
 */
export const FINANCE_HANDLED_TYPES = [
  'CODCollected',
  'CODPartialCollection',
  'CODCollectionFailed',
  'CODReconciled',
  'ReturnCompleted',
] as const;

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

interface CodReconciledPayload {
  readonly shipmentId: string;
  readonly merchantId: string;
  readonly currency: string;
  readonly reviewerId: string | null;
  readonly note: string;
  readonly expectedMinor: number;
  readonly collectedMinor: number | null;
}

/**
 * Standalone rather than `extends CodEnvelope`: `CodEnvelope.data.collectedMinor` is a plain number
 * because a collection always has one, and a review's is nullable because a record can be resolved
 * before any cash moved. Widening the base to `number | null` would push a null check into the
 * collection path, which cannot have one.
 */
interface ReconciledEnvelope {
  readonly id: string;
  readonly type: 'CODReconciled';
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly data: CodReconciledPayload;
}

interface ReturnCompletedPayload {
  readonly shipmentId: string;
  readonly merchantId: string;
  readonly currency: string;
  readonly reversedMinor: number;
  readonly returnId: string;
}

interface ReturnEnvelope {
  readonly id: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly data: ReturnCompletedPayload;
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

    if (!(FINANCE_HANDLED_TYPES as readonly string[]).includes(envelope.type)) {
      return 'ignored';
    }

    if (envelope.type === 'ReturnCompleted') {
      return this.postReversal(envelope as unknown as ReturnEnvelope);
    }

    if (envelope.type === 'CODReconciled') {
      return this.postReviewAdjustment(envelope as unknown as ReconciledEnvelope);
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
          collectionMemo(envelope.type, envelope.data.shipmentId),
          envelope.occurredAt,
        ],
      );

      return 'processed';
    });
  }

  /**
   * The reversal: a compensating ADJUSTMENT against the original collection, never
   * a rewrite. Both rows stay visible; the merchant reconciles collection against
   * reversal. Idempotent by reference: one reversal per return, replays converge.
   * A zero or negative amount is a no-op by construction — nothing was collected,
   * so there is nothing to reverse.
   */
  private async postReversal(
    envelope: ReturnEnvelope,
  ): Promise<'processed' | 'duplicate' | 'ignored' | 'malformed'> {
    if (!Number.isInteger(envelope.data.reversedMinor) || envelope.data.reversedMinor <= 0) {
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

      const existing = await manager.query(
        `SELECT id FROM finance.ledger_entries
          WHERE reference_type = 'RETURN' AND reference_id = $1`,
        [envelope.aggregateId],
      );
      if (existing.length > 0) return 'duplicate';

      await manager.query(
        `INSERT INTO finance.ledger_entries
           (id, merchant_id, entry_type, direction, amount_minor, currency,
            reference_type, reference_id, memo, occurred_at)
         VALUES ($1, $2, 'ADJUSTMENT', -1, $3, $4,
                 'RETURN', $5, $6, $7)`,
        [
          randomUUID(),
          envelope.data.merchantId,
          envelope.data.reversedMinor,
          envelope.data.currency,
          envelope.aggregateId,
          'COD reversal for returned shipment ' + envelope.data.shipmentId,
          envelope.occurredAt,
        ],
      );

      return 'processed';
    });
  }

  /**
   * The compensating row a review posts. Rule 8: a correction is a NEW row, never an edit, so the
   * collection the rider made and the decision ops made about it are both readable months later.
   *
   * Two shapes of no-op, and both are correct rather than defensive:
   *   - no collected figure (the record was resolved before any cash moved), or
   *   - the two figures already agree (`reviewAdjustment` returns null).
   * Posting a zero row would be an entry asserting something happened when nothing did.
   *
   * Idempotent by reference, like every other path here: one adjustment per COD record, so a
   * redelivered `CODReconciled` converges instead of double-correcting.
   */
  private async postReviewAdjustment(
    envelope: ReconciledEnvelope,
  ): Promise<'processed' | 'duplicate' | 'ignored' | 'malformed'> {
    const { expectedMinor, collectedMinor } = envelope.data;
    if (collectedMinor === null) return 'ignored';

    const adjustment = reviewAdjustment({ expectedMinor, collectedMinor });
    if (adjustment === null) return 'ignored';

    return this.finance.transaction(async (manager) => {
      const claimed = await manager.query(
        `INSERT INTO system.consumed_events (consumer, event_id)
         VALUES ($1, $2)
         ON CONFLICT (consumer, event_id) DO NOTHING
         RETURNING event_id`,
        [FINANCE_CONSUMER, envelope.id],
      );
      if (claimed.length === 0) return 'duplicate';

      const existing = await manager.query(
        `SELECT id FROM finance.ledger_entries
          WHERE reference_type = 'COD_RECORD' AND reference_id = $1
            AND entry_type = 'ADJUSTMENT'`,
        [envelope.aggregateId],
      );
      if (existing.length > 0) return 'duplicate';

      await manager.query(
        `INSERT INTO finance.ledger_entries
           (id, merchant_id, entry_type, direction, amount_minor, currency,
            reference_type, reference_id, memo, occurred_at)
         VALUES ($1, $2, 'ADJUSTMENT', $3, $4, $5,
                 'COD_RECORD', $6, $7, $8)`,
        [
          randomUUID(),
          envelope.data.merchantId,
          adjustment.direction,
          adjustment.amountMinor,
          // Carried on the event rather than read from `cod`: this consumer owns schema `finance`
          // and has no business opening another module's connection to learn a three-letter code.
          envelope.data.currency,
          envelope.aggregateId,
          `Reconciliation review for shipment ${envelope.data.shipmentId}: ${envelope.data.note}`,
          envelope.occurredAt,
        ],
      );

      return 'processed';
    });
  }
}

/** Why a collection row says what it says. A disputed figure is labelled as one on the row itself,
 *  so a ledger reader six months later is not left to infer the argument from a separate table. */
function collectionMemo(type: string, shipmentId: string): string {
  const subject = 'COD collected for shipment ' + shipmentId;
  return type === 'CODCollectionFailed' ? subject + ' — amount disputed, awaiting review' : subject;
}
