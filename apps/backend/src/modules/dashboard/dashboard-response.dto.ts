/**
 * Response DTOs for the dashboard module — the control tower's read surface.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * Hand-declared `interface`s in services do not generate OpenAPI schemas because TypeScript
 * erases them. See ADR-0004.
 *
 * Money, twice, because the wire format genuinely differs (rule 4).
 * `LiveCodCountsDto.outstandingAmountMinor` is a `bigint` aggregate serialised to a decimal string
 * at the edge by `DashboardController` — a JSON number would lose its tail above 2^53 poisha, so it
 * is `MoneyMinorString`. The KPI report's projection sums are coerced to JS `number` inside
 * `ProjectionQueriesService`, so they are documented as the integer JSON numbers they actually are
 * (`MoneyMinor`) — the spec describes the wire, not the ideal.
 */

import { ApiProperty } from '@nestjs/swagger';
import { MoneyMinor, MoneyMinorString } from '../../common/dto/money.ts';

/** Shipment counts: the flat buckets operators scan, plus the complete by-status map. */
export class LiveShipmentCountsDto {
  @ApiProperty({ example: 120 })
  total!: number;

  @ApiProperty({ example: 14, description: 'Created since the Asia/Dhaka day began.' })
  todayNew!: number;

  @ApiProperty({ example: 23 })
  inTransit!: number;

  @ApiProperty({ example: 18 })
  atHub!: number;

  @ApiProperty({ example: 6 })
  sorting!: number;

  @ApiProperty({ example: 9 })
  outForDelivery!: number;

  @ApiProperty({ example: 45 })
  delivered!: number;

  @ApiProperty({ example: 3 })
  failed!: number;

  @ApiProperty({ example: 2 })
  returned!: number;

  @ApiProperty({ example: 1, description: 'Mid-return: RETURN_IN_TRANSIT or later.' })
  returning!: number;

  @ApiProperty({ example: 4 })
  cancelled!: number;

  @ApiProperty({ example: 0 })
  onHold!: number;

  @ApiProperty({ example: 0, description: 'LOST + DAMAGED.' })
  lostOrDamaged!: number;

  @ApiProperty({ example: 0 })
  exception!: number;

  @ApiProperty({
    type: Object,
    additionalProperties: { type: 'integer' },
    example: {
      DRAFT: 0,
      CREATED: 1,
      PICKUP_REQUESTED: 0,
      PICKUP_ASSIGNED: 0,
      PICKED_UP: 0,
      AT_ORIGIN_HUB: 0,
      SORTING: 0,
      DISPATCHED: 0,
      IN_TRANSIT: 1,
      AT_DESTINATION_HUB: 0,
      OUT_FOR_DELIVERY: 1,
      DELIVERED: 2,
      DELIVERY_FAILED: 1,
      RETRY_SCHEDULED: 0,
      RETURN_INITIATED: 0,
      RETURN_IN_TRANSIT: 0,
      RETURN_AT_HUB: 0,
      RETURN_OUT_FOR_DELIVERY: 0,
      RETURNED: 1,
      ON_HOLD: 0,
      CANCELLED: 1,
      LOST: 0,
      DAMAGED: 0,
      EXCEPTION: 0,
    },
    description: 'Count per shipment status. Every status is a key; unseen ones are 0, not absent.',
  })
  byStatus!: Record<string, number>;
}

/** Pickup counts: the flat buckets plus the complete by-status map. */
export class LivePickupCountsDto {
  @ApiProperty({ example: 60 })
  total!: number;

  @ApiProperty({ example: 8, description: 'ASSIGNED + IN_PROGRESS.' })
  active!: number;

  @ApiProperty({ example: 3 })
  pending!: number;

  @ApiProperty({ example: 40 })
  completed!: number;

  @ApiProperty({ example: 6 })
  failed!: number;

  @ApiProperty({ example: 2 })
  expired!: number;

  @ApiProperty({ example: 1 })
  cancelled!: number;

  @ApiProperty({
    type: Object,
    additionalProperties: { type: 'integer' },
    example: {
      REQUESTED: 3,
      SCHEDULED: 0,
      ASSIGNED: 5,
      IN_PROGRESS: 3,
      COMPLETED: 40,
      FAILED: 6,
      EXPIRED: 2,
      CANCELLED: 1,
    },
    description: 'Count per pickup status. Every status is a key; unseen ones are 0, not absent.',
  })
  byStatus!: Record<string, number>;
}

/** Delivery counts: the flat buckets plus the complete by-status map. */
export class LiveDeliveryCountsDto {
  @ApiProperty({ example: 50 })
  total!: number;

  @ApiProperty({ example: 9 })
  outForDelivery!: number;

  @ApiProperty({ example: 4 })
  attempted!: number;

  @ApiProperty({ example: 2, description: 'Attempted, with attempts still left to make.' })
  attemptsRemaining!: number;

  @ApiProperty({ example: 5 })
  failed!: number;

  @ApiProperty({ example: 45 })
  delivered!: number;

  @ApiProperty({
    type: Object,
    additionalProperties: { type: 'integer' },
    example: {
      CREATED: 0,
      ASSIGNED: 5,
      ACCEPTED: 0,
      OUT_FOR_DELIVERY: 9,
      ATTEMPTED: 4,
      DELIVERED: 45,
      FAILED: 5,
    },
    description: 'Count per delivery status. Every status is a key; unseen ones are 0, not absent.',
  })
  byStatus!: Record<string, number>;
}

/**
 * COD counts. `outstandingAmountMinor` is the one aggregate here: a network-wide sum that can
 * exceed 2^53 poisha, so the controller serialises it to a decimal string before it leaves.
 */
export class LiveCodCountsDto {
  @ApiProperty({ example: 58 })
  total!: number;

  @ApiProperty({ example: 12 })
  expected!: number;

  @ApiProperty({ example: 9, description: 'Collected or payable, not yet settled.' })
  outstanding!: number;

  @MoneyMinorString({
    example: '1250500',
    description: 'Sum still outstanding, across every merchant.',
  })
  outstandingAmountMinor!: string;

  @ApiProperty({
    type: Object,
    additionalProperties: { type: 'integer' },
    example: {
      COD_EXPECTED: 12,
      COD_COLLECTED: 30,
      COD_RECONCILED: 3,
      COD_PAYABLE: 4,
      SETTLEMENT_CREATED: 2,
      SETTLED: 40,
      COLLECTION_FAILED: 1,
      PARTIAL_COLLECTION: 0,
      RECONCILIATION_EXCEPTION: 0,
      SETTLEMENT_HOLD: 0,
    },
    description: 'Count per COD status. Every status is a key; unseen ones are 0, not absent.',
  })
  byStatus!: Record<string, number>;
}

/** Rider counts: the flat buckets plus the complete by-status map. */
export class LiveRiderCountsDto {
  @ApiProperty({ example: 24 })
  total!: number;

  @ApiProperty({ example: 11, description: 'AVAILABLE + ON_PICKUP + ON_DELIVERY.' })
  online!: number;

  @ApiProperty({ example: 7, description: 'Online with no job in hand.' })
  available!: number;

  @ApiProperty({ example: 12 })
  offline!: number;

  @ApiProperty({ example: 1 })
  suspended!: number;

  @ApiProperty({
    type: Object,
    additionalProperties: { type: 'integer' },
    example: {
      OFFLINE: 12,
      AVAILABLE: 7,
      ON_PICKUP: 2,
      ON_DELIVERY: 2,
      ON_BREAK: 0,
      SUSPENDED: 1,
    },
    description: 'Count per rider status. Every status is a key; unseen ones are 0, not absent.',
  })
  byStatus!: Record<string, number>;
}

/** Hub counts: what is sitting in the network, and how many hubs there are to hold it. */
export class LiveHubCountsDto {
  @ApiProperty({ example: 24, description: 'AT_DESTINATION_HUB + SORTING + ON_HOLD everywhere.' })
  backlog!: number;

  @ApiProperty({ example: 6 })
  networkHubs!: number;
}

/** The whole network in one snapshot, every number taken in the same micro-batch. */
export class LiveCountsDto {
  @ApiProperty({
    example: '2026-10-10T06:00:00.000Z',
    description: 'UTC ISO 8601 snapshot instant.',
  })
  timestamp!: string;

  @ApiProperty({ type: LiveShipmentCountsDto })
  shipments!: LiveShipmentCountsDto;

  @ApiProperty({ type: LivePickupCountsDto })
  pickups!: LivePickupCountsDto;

  @ApiProperty({ type: LiveDeliveryCountsDto })
  deliveries!: LiveDeliveryCountsDto;

  @ApiProperty({ type: LiveCodCountsDto })
  cod!: LiveCodCountsDto;

  @ApiProperty({ type: LiveRiderCountsDto })
  riders!: LiveRiderCountsDto;

  @ApiProperty({ type: LiveHubCountsDto })
  hub!: LiveHubCountsDto;
}

/** Parcels created / picked up / delivered over the range, summed from the projections. */
export class ShipmentFlowKpiDto {
  @ApiProperty({ example: 340 })
  created!: number;

  @ApiProperty({ example: 320 })
  pickedUp!: number;

  @ApiProperty({ example: 280 })
  delivered!: number;
}

/** Delivery outcome over the range. `rate` is null for a window that resolved nothing. */
export class DeliverySuccessKpiDto {
  @ApiProperty({ example: 280 })
  delivered!: number;

  @ApiProperty({ example: 40 })
  failed!: number;

  @ApiProperty({
    example: 0.875,
    nullable: true,
    description: 'delivered / (delivered + failed). Null when the window resolved no delivery.',
  })
  rate!: number | null;
}

/** Returns over the range. `rate` is null for a window that delivered nothing. */
export class ReturnRateKpiDto {
  @ApiProperty({ example: 280 })
  delivered!: number;

  @ApiProperty({ example: 12 })
  returned!: number;

  @ApiProperty({
    example: 0.043,
    nullable: true,
    description: 'returned / delivered. Null when the window saw no delivery.',
  })
  rate!: number | null;
}

/**
 * One currency's COD totals over the range.
 *
 * The minor amounts are projection SUMs the service coerces to JS numbers, so they cross the wire
 * as integer JSON numbers — unlike `LiveCodCountsDto.outstandingAmountMinor`, which is a string.
 * Values beyond 2^53 poisha lose precision here; that is a known property of the projection read,
 * not of this description.
 */
export class CodCurrencyKpiDto {
  @ApiProperty({ example: 'BDT' })
  currency!: string;

  @MoneyMinor({ example: 4250000, description: 'COD expected over the range.' })
  expectedMinor!: number;

  @MoneyMinor({ example: 3800000, description: 'COD collected over the range.' })
  collectedMinor!: number;

  @MoneyMinor({ example: 3500000, description: 'COD settled over the range.' })
  settledMinor!: number;

  @ApiProperty({
    example: 0.894,
    nullable: true,
    description: 'collected / expected. Null when nothing was expected in the window.',
  })
  collectionRate!: number | null;
}

/** Rider workload over the range: deliveries, attempts, failures. */
export class RiderWorkKpiDto {
  @ApiProperty({ example: 280 })
  delivered!: number;

  @ApiProperty({ example: 310 })
  attempts!: number;

  @ApiProperty({ example: 40 })
  failed!: number;
}

/** One hub's scan volume over the range, ordered busiest first. */
export class HubVolumeKpiDto {
  @ApiProperty({ example: 'DHK-01' })
  hubCode!: string;

  @ApiProperty({ example: 412 })
  scans!: number;
}

/** The inclusive day range the report covers, in Asia/Dhaka buckets. */
export class ReportRangeDto {
  @ApiProperty({ example: '2026-09-10' })
  from!: string;

  @ApiProperty({ example: '2026-10-10' })
  to!: string;
}

/** Live hub backlog, one instant, from the same read contract as the live counts. */
export class ReportLiveHubDto {
  @ApiProperty({ example: 24 })
  backlog!: number;

  @ApiProperty({ example: 6 })
  networkHubs!: number;
}

/** Live exception counts: the shipments an operator must look at. */
export class ReportLiveExceptionsDto {
  @ApiProperty({ example: 0 })
  lostOrDamaged!: number;

  @ApiProperty({ example: 0 })
  exception!: number;
}

/** Live rider totals: the shape of the workforce right now. */
export class ReportLiveRidersDto {
  @ApiProperty({ example: 24 })
  total!: number;

  @ApiProperty({ example: 11 })
  online!: number;

  @ApiProperty({ example: 7 })
  available!: number;
}

/** Pool-wide rider capacity utilisation, one instant. Load factors are 0..1. */
export class PoolUtilisationDto {
  @ApiProperty({ example: 240 })
  totalCapacity!: number;

  @ApiProperty({ example: 176 })
  inUseCapacity!: number;

  @ApiProperty({ example: 0.733, description: 'inUseCapacity / totalCapacity.' })
  loadFactor!: number;

  @ApiProperty({ example: 0.71 })
  meanLoadFactor!: number;

  @ApiProperty({ example: 0.95 })
  maxLoadFactor!: number;

  @ApiProperty({ example: 0.42 })
  minLoadFactor!: number;
}

/** The live half of the report: one instant, beside the historical range. */
export class ReportLiveDto {
  @ApiProperty({
    example: '2026-10-10T06:00:00.000Z',
    description: 'UTC ISO 8601 snapshot instant.',
  })
  timestamp!: string;

  @ApiProperty({ type: ReportLiveHubDto })
  hub!: ReportLiveHubDto;

  @ApiProperty({ type: ReportLiveExceptionsDto })
  exceptions!: ReportLiveExceptionsDto;

  @ApiProperty({ type: ReportLiveRidersDto })
  riders!: ReportLiveRidersDto;

  @ApiProperty({ type: PoolUtilisationDto })
  poolUtilisation!: PoolUtilisationDto;
}

/**
 * The operational KPI report: projection sums over an inclusive day range, plus the live snapshot.
 *
 * Two time-views in one response — historical KPIs on the left, the live instant on the right.
 */
export class OperationsReportDto {
  @ApiProperty({ type: ReportRangeDto })
  range!: ReportRangeDto;

  @ApiProperty({ type: ShipmentFlowKpiDto })
  shipments!: ShipmentFlowKpiDto;

  @ApiProperty({ type: DeliverySuccessKpiDto })
  deliverySuccess!: DeliverySuccessKpiDto;

  @ApiProperty({ type: ReturnRateKpiDto })
  returns!: ReturnRateKpiDto;

  @ApiProperty({ type: CodCurrencyKpiDto, isArray: true, description: 'One entry per currency.' })
  cod!: readonly CodCurrencyKpiDto[];

  @ApiProperty({ type: RiderWorkKpiDto })
  riderWork!: RiderWorkKpiDto;

  @ApiProperty({ type: HubVolumeKpiDto, isArray: true, description: 'Busiest hub first.' })
  hubVolume!: readonly HubVolumeKpiDto[];

  @ApiProperty({ type: ReportLiveDto })
  live!: ReportLiveDto;
}

/** A hub on the map: a coordinate plus what is waiting there. */
export class MapHubDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'DHK-01' })
  code!: string;

  @ApiProperty({ example: 'Dhaka Sorting Hub' })
  name!: string;

  @ApiProperty({ example: 'HUB', description: 'HUB | LINE_HAUL_NODE — never ranged here.' })
  kind!: string;

  @ApiProperty({ example: 'dhaka-metro', nullable: true })
  networkZone!: string | null;

  @ApiProperty({ example: 90.4125, description: 'Longitude, WGS84 degrees.' })
  lng!: number;

  @ApiProperty({ example: 23.8103, description: 'Latitude, WGS84 degrees.' })
  lat!: number;

  @ApiProperty({ example: 18, description: 'Parcels sitting at this hub right now.' })
  parcelsWaiting!: number;
}

/**
 * A rider on the map. `staleSeconds` says how old the position is — a rider unseen for twenty
 * minutes is not "at" that dot, and the map must be able to say so.
 */
export class MapRiderDto {
  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  id!: string;

  @ApiProperty({ example: 'Rahim' })
  displayName!: string;

  @ApiProperty({ example: 'ON_DELIVERY' })
  status!: string;

  @ApiProperty({ example: 90.4125, description: 'Longitude, WGS84 degrees.' })
  lng!: number;

  @ApiProperty({ example: 23.8103, description: 'Latitude, WGS84 degrees.' })
  lat!: number;

  @ApiProperty({ example: 45, description: 'Seconds since the rider\u2019s last ping. 0 is live.' })
  staleSeconds!: number;

  @ApiProperty({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012', nullable: true })
  currentJobId!: string | null;
}

/**
 * The network, with coordinates: hubs and riders, never parcels.
 *
 * `generatedAt` lets a client label its own staleness instead of pretending the snapshot is now.
 */
export class NetworkMapDto {
  @ApiProperty({ type: MapHubDto, isArray: true })
  hubs!: readonly MapHubDto[];

  @ApiProperty({ type: MapRiderDto, isArray: true })
  riders!: readonly MapRiderDto[];

  @ApiProperty({
    example: 2,
    description: 'Riders with no ping yet. Counted, not plotted — a dot at (0,0) is in the ocean.',
  })
  ridersWithoutPosition!: number;

  @ApiProperty({
    example: '2026-10-10T06:00:00.000Z',
    description: 'UTC ISO 8601 snapshot instant.',
  })
  generatedAt!: string;
}
