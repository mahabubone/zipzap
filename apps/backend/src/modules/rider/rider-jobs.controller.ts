/**
 * GET /v1/riders/:riderId/jobs — one rider's pickups and delivery jobs.
 *
 * The rider app's home feed. Read-only aggregate, same shape as the dashboard's
 * live counts: each read is a single-schema query through the owning module's
 * DataSource; nothing joins across schemas. The rider app sorts and merges
 * client-side — this endpoint hands it the two ordered lists.
 *
 * Delivery jobs carry the parcel's cash amount and the recipient's phone, which
 * live on `shipment.shipments`. Rule 2 forbids joining that from here, so they
 * are read through `SHIPMENT_HANDOFF_LOOKUP` in one extra trip per chunk — the
 * rider's home feed is one round trip for the whole page, not one per job.
 */

import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { IsOptional, IsString } from 'class-validator';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { PickupRepository } from '../pickup/pickup.repository.ts';
import { DeliveryRepository } from '../delivery/delivery.repository.ts';
import {
  RiderDeliveryJobDto,
  RiderJobsDto,
  type RecipientDto,
  type ShipmentHandoffDto,
} from './rider-response.dto.ts';
import {
  SHIPMENT_HANDOFF_LOOKUP,
  type ShipmentHandoffLookup,
} from '../shipment/shipment-handoff.lookup.ts';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class RiderJobsQuery {
  /** Cap on each list. Defaults to 20, maximum 100 — the rider app merges the two itself. */
  @IsOptional()
  @IsString()
  limit?: string;
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Flatten a handoff out of the delivery job's own field shape.
 *
 * The two are kept separate on the wire because they answer different questions
 * and change for different reasons: a rider reads one at a door, the other when
 * deciding whether to ring at all. Flattening them here would leak the shipment
 * entity's nullability into a contract a device app is written against.
 */
function toRecipient(
  handoff:
    | {
        recipientName: string | null;
        recipientAddress: string | null;
        recipientPhone: string | null;
      }
    | undefined,
): RecipientDto | null {
  if (!handoff) return null;
  return {
    name: handoff.recipientName,
    address: handoff.recipientAddress,
    phone: handoff.recipientPhone,
  };
}

function toHandoff(
  handoff: { shipmentId: string; codAmountMinor: number; codCurrency: string } | undefined,
): ShipmentHandoffDto | null {
  if (!handoff) return null;
  return {
    shipmentId: handoff.shipmentId,
    codAmountMinor: handoff.codAmountMinor,
    codCurrency: handoff.codCurrency,
  };
}

@ApiTags('riders')
@Controller('v1/riders')
@UseGuards(ApiKeyGuard)
export class RiderJobsController {
  constructor(
    @Inject(PickupRepository) private readonly pickups: PickupRepository,
    @Inject(DeliveryRepository) private readonly deliveries: DeliveryRepository,
    @InjectDataSource('pickup') private readonly pickupDs: DataSource,
    @InjectDataSource('delivery') private readonly deliveryDs: DataSource,
    @Inject(SHIPMENT_HANDOFF_LOOKUP) private readonly handoffs: ShipmentHandoffLookup,
  ) {}

  @Get(':riderId/jobs')
  @ApiOperation({ summary: "A rider's pickup and delivery jobs, newest first" })
  @ApiParam({
    name: 'riderId',
    description: 'The rider whose pickup and delivery jobs are listed.',
  })
  @ApiOkResponse({
    type: RiderJobsDto,
    description:
      "The rider's home feed: pickup batches and delivery jobs assigned to this rider, each " +
      'list newest first, both capped by the same limit. The rider app sorts and merges the two ' +
      'client-side — this endpoint hands them over without joining across schemas.',
  })
  @ApiErrors()
  async jobs(
    @Param('riderId') riderId: string,
    @Query() query: RiderJobsQuery,
  ): Promise<RiderJobsDto> {
    const take = parseLimit(query.limit);
    const [pickups, deliveries] = await Promise.all([
      this.pickups.listByRider(this.pickupDs.manager, riderId, take),
      this.deliveries.listByRider(this.deliveryDs.manager, riderId, take),
    ]);

    // One read for the whole page. A missing shipment is not an error: a parcel
    // cancelled while the rider was offline still has a job on the van, and the
    // handoff stays null rather than guessing what was on it.
    const handoffs = await this.handoffs.forShipments(deliveries.map((d) => d.shipmentId));

    const deliveryJobs: RiderDeliveryJobDto[] = deliveries.map((job) => {
      const handoff = handoffs.get(job.shipmentId);
      return {
        id: job.id,
        shipmentId: job.shipmentId,
        riderId: job.riderId,
        status: job.status,
        attemptsMade: job.attemptsMade,
        lastFailureReason: job.lastFailureReason,
        shipment: toHandoff(handoff),
        recipient: toRecipient(handoff),
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
    });

    return { pickups, deliveries: deliveryJobs };
  }
}
