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
import { money, type Money } from '../../common/money.ts';
import { hashRequest } from '../../common/idempotency.ts';
import {
  InvalidIdempotencyKeyError,
  ServiceabilityFailedError,
} from '../../common/domain-error.ts';
import { claim } from '../system/idempotency.store.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { ShipmentRepository } from './shipment.repository.ts';
import { shipmentsCreatedTotal } from '../../common/metrics';
import { PricingService } from '../pricing/pricing.service.ts';
import { EnsureCodRecordService } from '../cod/ensure-cod-record.service.ts';
import { NetworkService } from '../network/network.service.ts';
import {
  createShipment,
  generateTrackingCode,
  type Address,
  type Parcel,
} from './rules/shipment.ts';
import { transition } from './rules/shipment.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';

export interface CreateShipmentCommand {
  readonly merchantId: string;
  readonly merchantPlan: string;
  readonly zone: string;
  readonly remoteArea: boolean;
  readonly fragile: boolean;
  readonly packagingKind: string | null;
  readonly sender: Address;
  readonly recipient: Address;
  readonly parcel: Parcel;
  readonly cod?: Money;
  /** The merchant's own invoice reference. The bulk dedupe anchor; null for single creates. */
  readonly merchantReference?: string | null;
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
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(EnsureCodRecordService) private readonly cod: EnsureCodRecordService,
    @Inject(NetworkService) private readonly network: NetworkService,
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
      merchantPlan: command.merchantPlan,
      zone: command.zone,
      remoteArea: command.remoteArea,
      fragile: command.fragile,
      packagingKind: command.packagingKind,
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

      // Serviceability: coverage rows answer, before anything is written. A replay
      // above already returned — a rejection here rolls back the claim too, so the
      // idempotency key stays usable after coverage is fixed. Unknown zone = no row
      // = not serviceable, with the zone named in the reason (Phase 2 exit gate).
      const coverage = await this.network.checkZone(command.zone);
      if (!coverage.serviceable) {
        throw new ServiceabilityFailedError(coverage.reason ?? 'Destination not serviceable.');
      }
      if ((command.cod?.amountMinor ?? 0) > 0 && !coverage.codAvailable) {
        throw new ServiceabilityFailedError(`COD is not available in zone "${command.zone}".`);
      }

      // DRAFT -> CREATED, validated. A caller cannot set a status directly.
      // The quote is computed BEFORE the transaction: pricing is read-only and deterministic,
      // so it needs no lock — and quoting inside the transaction would hold it open while
      // resolving a version row it never writes.
      const quote = await this.pricing.quote({
        weightGrams: command.parcel.weightGrams,
        codAmountMinor: command.cod?.amountMinor ?? 0,
        zone: command.zone,
        remoteArea: command.remoteArea,
        fragile: command.fragile,
        packagingKind: command.packagingKind,
        merchantPlan: command.merchantPlan,
        currency: command.cod?.currency,
      });

      const draft = createShipment({
        id: randomUUID(),
        merchantId: command.merchantId,
        sender: command.sender,
        recipient: command.recipient,
        parcel: command.parcel,
        cod: command.cod ?? money(0),
        trackingCode: generateTrackingCode(),
        pricingVersion: quote.version,
      });
      const shipment = transition(draft, 'CREATED');

      await this.shipments.insert(manager, {
        id: shipment.id,
        trackingCode: shipment.trackingCode,
        merchantId: shipment.merchantId,
        merchantReference: command.merchantReference ?? null,
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

      // Same transaction: the COD promise, seeded from the frozen quote. Zero-COD shipments get
      // no record — there is nothing to promise, collect, or reconcile. Without this call the
      // record would never exist and every collect would 404.
      await this.cod.ensure(manager, {
        shipmentId: shipment.id,
        merchantId: shipment.merchantId,
        expectedMinor: shipment.cod.amountMinor,
        currency: shipment.cod.currency,
      });

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
      shipmentsCreatedTotal.inc();

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
