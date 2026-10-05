/**
 * RequestReturn + ApproveReturn + AdvanceReturn — the full return machine.
 *
 * Request is idempotency-keyed per shipment: one return per parcel, ever (the
 * unique index enforces it; the key makes the retry safe). Approval is the
 * merchant decision with an audit trail — a return that auto-approves refunds
 * money without agreement. Advance walks the transit legs: INITIATED ->
 * IN_TRANSIT -> AT_HUB -> TO_MERCHANT -> RETURNED, each a pure status move with
 * a tracking event and an outbox event.
 *
 * Money never moves here. On RETURNED, the service emits ReturnCompleted; finance
 * answers with a compensating ADJUSTMENT against the original COD collection.
 * Financial consequences as events, never calculated twice.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { InvalidIdempotencyKeyError, ResourceNotFoundError } from '../../common/domain-error.ts';
import { hashRequest } from '../../common/idempotency.ts';
import { claim } from '../system/idempotency.store.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { ShipmentAdvanceService } from '../shipment/advance-shipment.service.ts';
import type { ShipmentStatus } from '../shipment/rules/state-machine.ts';
import { COD_LOOKUP, type CodLookup } from '../cod/cod.lookup.ts';
import { ReturnRequestRepository } from './return-request.repository.ts';
import { assertTransition, type ReturnReason, type ReturnStatus } from './rules/returns.ts';

const RESPONSE_META = { statusCode: 200 };

export interface RequestReturnCommand {
  readonly shipmentId: string;
  readonly merchantId: string;
  readonly reason: ReturnReason;
  readonly idempotencyKey: string;
}

export interface RequestedReturn {
  readonly id: string;
  readonly shipmentId: string;
  readonly status: ReturnStatus;
}

export interface DecideReturnCommand {
  readonly returnId: string;
  readonly approverId: string;
  readonly note: string;
}

export interface AdvanceReturnCommand {
  readonly returnId: string;
  readonly actorId: string | null;
}

@Injectable()
export class ReturnService {
  constructor(
    @InjectDataSource('returns') private readonly returns: DataSource,
    @Inject(ReturnRequestRepository) private readonly requests: ReturnRequestRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
    @Inject(COD_LOOKUP) private readonly cod: CodLookup,
    @Inject(ShipmentAdvanceService) private readonly advanceShipment: ShipmentAdvanceService,
  ) {}

  async request(command: RequestReturnCommand): Promise<{
    result: RequestedReturn;
    replayed: boolean;
  }> {
    const requestHash = hashRequest({ shipmentId: command.shipmentId });

    return this.returns.transaction(async (manager) => {
      const claimed = await claim(
        manager,
        { scope: 'return.request', merchantId: command.merchantId, key: command.idempotencyKey },
        requestHash,
      );
      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different request body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        return { result: claimed.decision.responseBody as RequestedReturn, replayed: true };
      }

      const existing = await this.requests.findByShipmentId(manager, command.shipmentId);
      if (existing) {
        throw new InvalidIdempotencyKeyError(
          'This shipment already has a return; request again only with a new parcel.',
        );
      }

      const now = new Date();
      const saved = await this.requests.insert(manager, {
        id: randomUUID(),
        shipmentId: command.shipmentId,
        merchantId: command.merchantId,
        reason: command.reason,
        status: 'RETURN_REQUESTED',
        reviewNote: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      } as never);

      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: command.shipmentId,
        eventType: 'RETURN_INITIATED',
        occurredAt: now,
        actorType: 'MERCHANT',
        actorId: null,
        metadata: { returnId: saved.id, reason: command.reason },
      });

      await appendOutbox(manager, {
        type: 'ReturnRequested',
        aggregateType: 'return',
        aggregateId: saved.id,
        payload: {
          shipmentId: command.shipmentId,
          merchantId: command.merchantId,
          reason: command.reason,
        },
        occurredAt: now,
      });

      const result: RequestedReturn = {
        id: saved.id,
        shipmentId: command.shipmentId,
        status: 'RETURN_REQUESTED',
      };
      await claimed.complete(RESPONSE_META.statusCode, result);
      return { result, replayed: false };
    });
  }

  /** Approve or reject — the merchant decision, recorded with reviewer + note. */
  async decide(
    command: DecideReturnCommand & { approve: boolean },
  ): Promise<{ id: string; status: ReturnStatus }> {
    return this.returns.transaction(async (manager) => {
      const request = await this.requests.findByIdForUpdate(manager, command.returnId);
      if (!request) throw new ResourceNotFoundError('Return request not found.');

      const next: ReturnStatus = command.approve ? 'RETURN_APPROVED' : 'RETURN_REJECTED';
      assertTransition(request.status as ReturnStatus, next);

      const now = new Date();
      request.status = next;
      request.reviewNote = command.note;
      request.decidedBy = command.approverId;
      request.decidedAt = now;
      await this.requests.save(manager, request);

      await appendOutbox(manager, {
        type: command.approve ? 'ReturnApproved' : 'ReturnRejected',
        aggregateType: 'return',
        aggregateId: request.id,
        payload: {
          shipmentId: request.shipmentId,
          merchantId: request.merchantId,
          reviewerId: command.approverId,
          note: command.note,
        },
        occurredAt: now,
      });

      return { id: request.id, status: next };
    });
  }

  /** Walk one transit leg. Each edge is idempotent by construction (the machine rejects repeats). */
  async advance(command: AdvanceReturnCommand): Promise<{ id: string; status: ReturnStatus }> {
    return this.returns.transaction(async (manager) => {
      const request = await this.requests.findByIdForUpdate(manager, command.returnId);
      if (!request) throw new ResourceNotFoundError('Return request not found.');

      const next = NEXT_LEG[request.status as ReturnStatus];
      if (!next) {
        throw new ResourceNotFoundError('Return is not in transit.');
      }
      assertTransition(request.status as ReturnStatus, next);

      const now = new Date();
      request.status = next;
      await this.requests.save(manager, request);

      // The parcel moves through the return legs alongside the request row —
      // leg names match the shipment machine (RETURN_INITIATED → … → RETURNED),
      // so the customer timeline and the aggregate agree on where it is. The
      // shipment must already be in a return-eligible state (delivered, refused,
      // scheduled for retry): anything else 409s through the machine.
      await this.advanceShipment.advance(manager, request.shipmentId, next as ShipmentStatus);

      // On completion, emit what finance needs to reverse: the collected amount
      // as measured by COD, not by us. Zero/never-collected emits zero — finance
      // treats that as nothing-to-reverse, never as an entry.
      const collected =
        next === 'RETURNED' ? await this.cod.findCollected(request.shipmentId) : null;

      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: request.shipmentId,
        eventType: next === 'RETURNED' ? 'RETURNED' : 'RETURN_INITIATED',
        occurredAt: now,
        actorType: 'RIDER',
        actorId: command.actorId,
        metadata: { returnId: request.id, leg: next },
      });

      await appendOutbox(manager, {
        type: next === 'RETURNED' ? 'ReturnCompleted' : 'ReturnAdvanced',
        aggregateType: 'return',
        aggregateId: request.id,
        payload: {
          shipmentId: request.shipmentId,
          merchantId: request.merchantId,
          leg: next,
          returnId: request.id,
          reversedMinor: collected?.collectedMinor ?? 0,
          currency: collected?.currency ?? 'BDT',
        },
        occurredAt: now,
      });

      return { id: request.id, status: next };
    });
  }
}

/** The linear transit chain. Terminal and pre-transit states advance nowhere. */
const NEXT_LEG: Partial<Record<ReturnStatus, ReturnStatus>> = {
  RETURN_APPROVED: 'RETURN_INITIATED',
  RETURN_INITIATED: 'RETURN_IN_TRANSIT',
  RETURN_IN_TRANSIT: 'RETURN_AT_HUB',
  RETURN_AT_HUB: 'RETURN_OUT_FOR_DELIVERY',
  RETURN_OUT_FOR_DELIVERY: 'RETURNED',
};
