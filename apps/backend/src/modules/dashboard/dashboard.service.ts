/**
 * Dashboard — the control-tower read surface (Phase 6).
 *
 * It exposes live network counts without touching or changing any domain state. Every count
 * is a single-schema read owned by one domain module — the dashboard never joins across
 * schemas (rule 2): it aggregates many such reads, each going through the owner module's own
 * connection manager, and takes the whole snapshot in one micro-batch so the numbers describe
 * a single instant of the live system. Nothing is written here, so no transaction is
 * required.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SHIPMENT_STATUSES, type ShipmentStatus } from '../shipment/rules/state-machine.ts';
import { PICKUP_STATUSES, type PickupStatus } from '../pickup/rules/pickup.ts';
import { DELIVERY_STATUSES, type DeliveryStatus } from '../delivery/rules/delivery.ts';
import { COD_STATUSES, type CodStatus } from '../cod/rules/cod.ts';
import { RIDER_STATUSES, type RiderStatus } from '../rider/rules/rider.ts';
import { ShipmentRepository } from '../shipment/shipment.repository.ts';
import { PickupRepository } from '../pickup/pickup.repository.ts';
import { DeliveryRepository } from '../delivery/delivery.repository.ts';
import { CodRecordRepository } from '../cod/cod-record.repository.ts';
import { RiderRepository } from '../rider/rider.repository.ts';
import { HubRepository } from '../hub/hub.repository.ts';

export interface LiveCounts {
  /** Snapshot timestamp, UTC ISO 8601. */
  readonly timestamp: string;

  readonly shipments: {
    readonly total: number;
    readonly todayNew: number;
    readonly inTransit: number;
    readonly atHub: number;
    readonly sorting: number;
    readonly outForDelivery: number;
    readonly delivered: number;
    readonly failed: number;
    readonly returned: number;
    readonly returning: number;
    readonly cancelled: number;
    readonly onHold: number;
    readonly lostOrDamaged: number;
    readonly exception: number;
    readonly byStatus: Record<ShipmentStatus, number>;
  };

  readonly pickups: {
    readonly total: number;
    readonly active: number;
    readonly pending: number;
    readonly completed: number;
    readonly failed: number;
    readonly expired: number;
    readonly cancelled: number;
    readonly byStatus: Record<PickupStatus, number>;
  };

  readonly deliveries: {
    readonly total: number;
    readonly outForDelivery: number;
    readonly attempted: number;
    readonly attemptsRemaining: number;
    readonly failed: number;
    readonly delivered: number;
    readonly byStatus: Record<DeliveryStatus, number>;
  };

  readonly cod: {
    readonly total: number;
    readonly expected: number;
    readonly outstanding: number;
    readonly outstandingAmountMinor: bigint;
    readonly byStatus: Record<CodStatus, number>;
  };

  readonly riders: {
    readonly total: number;
    readonly online: number;
    readonly available: number;
    readonly offline: number;
    readonly suspended: number;
    readonly byStatus: Record<RiderStatus, number>;
  };

  readonly hub: {
    readonly backlog: number;
    readonly networkHubs: number;
  };
}

function buildStatusMap<T extends string>(
  known: Map<string, number>,
  statuses: readonly T[],
): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const s of statuses) {
    out[s] = known.get(s) ?? 0;
  }
  return out;
}

function nowISO(): string {
  return new Date().toISOString();
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource('shipment') private readonly shipmentDs: DataSource,
    @InjectDataSource('pickup') private readonly pickupDs: DataSource,
    @InjectDataSource('delivery') private readonly deliveryDs: DataSource,
    @InjectDataSource('cod') private readonly codDs: DataSource,
    @InjectDataSource('rider') private readonly riderDs: DataSource,
    @InjectDataSource('hub') private readonly hubDs: DataSource,
    @Inject(ShipmentRepository) private readonly shipments: ShipmentRepository,
    @Inject(PickupRepository) private readonly pickups: PickupRepository,
    @Inject(DeliveryRepository) private readonly deliveries: DeliveryRepository,
    @Inject(CodRecordRepository) private readonly cod: CodRecordRepository,
    @Inject(RiderRepository) private readonly riders: RiderRepository,
    @Inject(HubRepository) private readonly hub: HubRepository,
  ) {}

  /**
   * One snapshot of the network, right now.
   *
   * Every count is a single-schema read through the owner module's manager. All reads
   * run in one micro-batch, so the snapshot describes the system at one instant; the
   * timestamp is taken at the start of the batch. Nothing is written here.
   */
  async getLiveCounts(): Promise<LiveCounts> {
    const timestamp = nowISO();

    // Full by-status maps (a single GROUP BY each, one query per schema).
    const [shipmentCounts, pickupCounts, deliveryCounts, codCounts, riderCounts] =
      await Promise.all([
        this.shipments.countsByStatus(this.shipmentDs.manager),
        this.pickups.countsByStatus(this.pickupDs.manager),
        this.deliveries.countsByStatus(this.deliveryDs.manager),
        this.cod.countsByStatus(this.codDs.manager),
        this.riders.countsByStatus(this.riderDs.manager),
      ]);

    // Grouped counts, taken in the same batch so they share the same snapshot instant.
    const [
      shipmentTotal,
      pickupTotal,
      deliveryTotal,
      codTotal,
      riderTotal,
      todayNew,
      inTransit,
      atHub,
      sorting,
      outForDelivery,
      deliveredShipment,
      failedShipment,
      returned,
      returning,
      cancelled,
      onHold,
      lostOrDamaged,
      exception,
      active,
      pending,
      completed,
      failedPickup,
      expired,
      cancelledPickup,
      outForDeliveryDelivery,
      attempted,
      attemptsRemaining,
      failedDelivery,
      deliveredDelivery,
      codExpected,
      codOutstanding,
      codOutstandingAmount,
      online,
      available,
      offline,
      suspended,
      networkHubs,
    ] = await Promise.all([
      this.shipments.countByStatuses(this.shipmentDs.manager, SHIPMENT_STATUSES),
      this.pickups.countByStatuses(this.pickupDs.manager, PICKUP_STATUSES),
      this.deliveries.countByStatuses(this.deliveryDs.manager, DELIVERY_STATUSES),
      this.cod.countByStatuses(this.codDs.manager, COD_STATUSES),
      this.riders.countByStatuses(this.riderDs.manager, RIDER_STATUSES),
      this.shipments.countTodayShipments(this.shipmentDs.manager),
      this.shipments.countInTransit(this.shipmentDs.manager),
      this.shipments.countAtHub(this.shipmentDs.manager),
      this.shipments.countSorting(this.shipmentDs.manager),
      this.shipments.countOutForDelivery(this.shipmentDs.manager),
      this.shipments.countDelivered(this.shipmentDs.manager),
      this.shipments.countFailed(this.shipmentDs.manager),
      this.shipments.countReturned(this.shipmentDs.manager),
      this.shipments.countReturning(this.shipmentDs.manager),
      this.shipments.countCancelled(this.shipmentDs.manager),
      this.shipments.countOnHold(this.shipmentDs.manager),
      this.shipments.countLostOrDamaged(this.shipmentDs.manager),
      this.shipments.countException(this.shipmentDs.manager),
      this.pickups.countActivePickups(this.pickupDs.manager),
      this.pickups.countPendingPickups(this.pickupDs.manager),
      this.pickups.countCompleted(this.pickupDs.manager),
      this.pickups.countFailedPickups(this.pickupDs.manager),
      this.pickups.countExpired(this.pickupDs.manager),
      this.pickups.countCancelledPickups(this.pickupDs.manager),
      this.deliveries.countOutForDelivery(this.deliveryDs.manager),
      this.deliveries.countByStatus(this.deliveryDs.manager, 'ATTEMPTED'),
      this.deliveries.countAttemptsRemaining(this.deliveryDs.manager),
      this.deliveries.countFailedDeliveries(this.deliveryDs.manager),
      this.deliveries.countDeliveredDeliveries(this.deliveryDs.manager),
      this.cod.countByStatus(this.codDs.manager, 'COD_EXPECTED'),
      this.cod.countOutstandingCOD(this.codDs.manager),
      this.cod.sumOutstandingCODMinor(this.codDs.manager),
      this.riders.countOnlineRiders(this.riderDs.manager),
      this.riders.countAvailableRiders(this.riderDs.manager),
      this.riders.countOfflineRiders(this.riderDs.manager),
      this.riders.countSuspendedRiders(this.riderDs.manager),
      this.hub.countHubs(this.hubDs.manager),
    ]);

    return {
      timestamp,
      shipments: {
        total: shipmentTotal,
        todayNew,
        inTransit,
        atHub,
        sorting,
        outForDelivery,
        delivered: deliveredShipment,
        failed: failedShipment,
        returned,
        returning,
        cancelled,
        onHold,
        lostOrDamaged,
        exception,
        byStatus: buildStatusMap(shipmentCounts, SHIPMENT_STATUSES),
      },
      pickups: {
        total: pickupTotal,
        active,
        pending,
        completed,
        failed: failedPickup,
        expired,
        cancelled: cancelledPickup,
        byStatus: buildStatusMap(pickupCounts, PICKUP_STATUSES),
      },
      deliveries: {
        total: deliveryTotal,
        outForDelivery: outForDeliveryDelivery,
        attempted,
        attemptsRemaining,
        failed: failedDelivery,
        delivered: deliveredDelivery,
        byStatus: buildStatusMap(deliveryCounts, DELIVERY_STATUSES),
      },
      cod: {
        total: codTotal,
        expected: codExpected,
        outstanding: codOutstanding,
        outstandingAmountMinor: codOutstandingAmount,
        byStatus: buildStatusMap(codCounts, COD_STATUSES),
      },
      riders: {
        total: riderTotal,
        online,
        available,
        offline,
        suspended,
        byStatus: buildStatusMap(riderCounts, RIDER_STATUSES),
      },
      hub: {
        backlog: atHub + sorting,
        networkHubs,
      },
    };
  }
}
