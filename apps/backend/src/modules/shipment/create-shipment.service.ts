/**
 * CreateShipment.
 *
 * This is where the architecture either holds or does not. Four writes, one transaction:
 *
 *   1. shipment.shipments          the aggregate
 *   2. tracking.events             the movement history
 *   3. system.outbox_events        the event to publish
 *   4. system.idempotency_keys     the retry guard
 *
 * They commit together or not at all. The outbox row is written by THIS transaction, not by a
 * decorator or a later hook — a hook that runs after commit reintroduces the dual-write bug that
 * the outbox exists to eliminate (ADR-0005).
 *
 * The transaction boundary lives here, in the application layer. No repository opens its own.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { money, type Money } from '../../../common/money.ts';
import { hashRequest } from '../../../common/idempotency.ts';
import { InvalidIdempotencyKeyError } from '../../../common/domain-error.ts';
import { claim } from '../../system/idempotency.store.ts';
import { append as appendOutbox } from '../../system/outbox.writer.ts';
import { ShipmentRepository } from '../infrastructure/shipment.repository.ts';
import {
  createShipment,
  generateTrackingCode,
  type Address,
  type Parcel,
} from '../domain/shipment.ts';
import { transition } from '../domain/shipment.ts';
import { AppendTrackingEventService } from '../../tracking/application/append-tracking-event.service.ts';

export interface CreateShipmentCommand {
  readonly merchantId: string;
  readonly sender: Address;
  readonly recipient: Address;
  readonly parcel: Parcel;
  readonly cod?: Money;
  readonly idempotencyKey: string;
  readonly actorId: string | null;
}

export interface CreatedShipment {
  readonly id: string;
  readonly trackingCode: string;
  readonly status: string;
  readonly cod: { readonly amountMinor: number; readonly currency: string };
  readonly createdAt: string;
}

/** The response is what a replayed Idempotency-Key returns, byte for byte. */
const RESPONSE_META = { statusCode: 201 };

@Injectable()
export class CreateShipmentService {
  constructor(
    @InjectDataSource('shipment') private readonly shipmentDataSource: DataSource,
    @Inject(ShipmentRepository) private readonly shipments: ShipmentRepository,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
  ) {}

  async execute(command: CreateShipmentCommand): Promise<{
    result: CreatedShipment;
    replayed: boolean;
  }> {
    const requestHash = hashRequest({
      merchantId: command.merchantId,
      sender: command.sender,
      recipient: command.recipient,
      parcel: command.parcel,
      cod: command.cod?.amountMinor ?? 0,
      currency: command.cod?.currency ?? 'BDT',
    });

    return this.shipmentDataSource.transaction(async (manager) => {
      // The idempotency row is written in THIS transaction. Recorded outside it, a key could
      // outlive a rollback and permanently block a request that never happened.
      const claimed = await claim(
        manager,
        { scope: 'shipment.create', merchantId: command.merchantId, key: command.idempotencyKey },
        requestHash,
      );

      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different request body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        return {
          result: claimed.decision.responseBody as CreatedShipment,
          replayed: true,
        };
      }

      // DRAFT -> CREATED, validated. A caller cannot set a status directly.
      const draft = createShipment({
        id: randomUUID(),
        merchantId: command.merchantId,
        sender: command.sender,
        recipient: command.recipient,
        parcel: command.parcel,
        cod: command.cod ?? money(0),
        trackingCode: generateTrackingCode(),
      });
      const shipment = transition(draft, 'CREATED');

      await this.shipments.insert(manager, {
        id: shipment.id,
        trackingCode: shipment.trackingCode,
        merchantId: shipment.merchantId,
        senderName: shipment.sender.name,
        senderPhone: shipment.sender.phone,
        senderAddress: shipment.sender.line,
        recipientName: shipment.recipient.name,
        recipientPhone: shipment.recipient.phone,
        recipientAddress: shipment.recipient.line,
        parcelWeightGrams: shipment.parcel.weightGrams,
        parcelDescription: shipment.parcel.description,
        codAmountMinor: shipment.cod.amountMinor,
        codCurrency: shipment.cod.currency,
        status: shipment.status,
        heldFromStatus: shipment.heldFromStatus,
        pricingVersion: shipment.pricingVersion,
        createdAt: shipment.createdAt,
        updatedAt: shipment.createdAt,
      } as never);

      // Same transaction: the movement history.
      await this.tracking.append(manager, {
        id: randomUUID(),
        shipmentId: shipment.id,
        eventType: 'SHIPMENT_CREATED',
        occurredAt: shipment.createdAt,
        actorType: 'MERCHANT',
        actorId: command.actorId,
        metadata: { trackingCode: shipment.trackingCode },
      });

      // Same transaction: the event to publish.
      await appendOutbox(manager, {
        type: 'ShipmentCreated',
        aggregateType: 'shipment',
        aggregateId: shipment.id,
        payload: {
          merchantId: shipment.merchantId,
          trackingCode: shipment.trackingCode,
          status: shipment.status,
          cod: { amountMinor: shipment.cod.amountMinor, currency: shipment.cod.currency },
        },
      });

      const result: CreatedShipment = {
        id: shipment.id,
        trackingCode: shipment.trackingCode,
        status: shipment.status,
        cod: { amountMinor: shipment.cod.amountMinor, currency: shipment.cod.currency },
        createdAt: shipment.createdAt.toISOString(),
      };

      // Store the response so a retry returns the original, not a 409.
      await claimed.complete(RESPONSE_META.statusCode, result);

      return { result, replayed: false };
    });
  }
}
