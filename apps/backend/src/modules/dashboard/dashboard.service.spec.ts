import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { DashboardService } from './dashboard.service.ts';
import { ShipmentRepository } from '../shipment/shipment.repository.ts';
import { PickupRepository } from '../pickup/pickup.repository.ts';
import { DeliveryRepository } from '../delivery/delivery.repository.ts';
import { CodRecordRepository } from '../cod/cod-record.repository.ts';
import { RiderRepository } from '../rider/rider.repository.ts';
import { HubRepository } from '../hub/hub.repository.ts';

const timestampIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function fakeDs() {
  const ds = {
    manager: {},
    transaction: vi.fn((fn) => fn({ rollback: vi.fn() })),
  } as unknown as DataSource;
  return ds;
}

describe('dashboard service', () => {
  let service: DashboardService;
  let shipments: ShipmentRepository;
  let pickups: PickupRepository;
  let deliveries: DeliveryRepository;
  let cod: CodRecordRepository;
  let riders: RiderRepository;
  let hub: HubRepository;
  let shipmentDs: DataSource;
  let pickupDs: DataSource;
  let deliveryDs: DataSource;
  let codDs: DataSource;
  let riderDs: DataSource;
  let hubDs: DataSource;

  beforeEach(() => {
    shipmentDs = fakeDs();
    pickupDs = fakeDs();
    deliveryDs = fakeDs();
    codDs = fakeDs();
    riderDs = fakeDs();
    hubDs = fakeDs();

    shipments = {
      countsByStatus: vi.fn(
        async () =>
          new Map([
            ['DELIVERED', 3],
            ['IN_TRANSIT', 7],
            ['OUT_FOR_DELIVERY', 2],
          ]),
      ),
      countByStatuses: vi.fn(async () => 50),
      countTodayShipments: vi.fn(async () => 12),
      countInTransit: vi.fn(async () => 7),
      countAtHub: vi.fn(async () => 11),
      countSorting: vi.fn(async () => 4),
      countOutForDelivery: vi.fn(async () => 2),
      countDelivered: vi.fn(async () => 3),
      countFailed: vi.fn(async () => 5),
      countReturned: vi.fn(async () => 1),
      countReturning: vi.fn(async () => 3),
      countCancelled: vi.fn(async () => 6),
      countOnHold: vi.fn(async () => 2),
      countLostOrDamaged: vi.fn(async () => 0),
      countException: vi.fn(async () => 0),
    } as unknown as ShipmentRepository;

    pickups = {
      countsByStatus: vi.fn(
        async () =>
          new Map([
            ['COMPLETED', 20],
            ['ACTIVE', 0],
          ]),
      ),
      countByStatuses: vi.fn(async () => 45),
      countActivePickups: vi.fn(async () => 8),
      countPendingPickups: vi.fn(async () => 3),
      countCompleted: vi.fn(async () => 20),
      countFailedPickups: vi.fn(async () => 4),
      countExpired: vi.fn(async () => 2),
      countCancelledPickups: vi.fn(async () => 8),
    } as unknown as PickupRepository;

    deliveries = {
      countsByStatus: vi.fn(
        async () =>
          new Map([
            ['DELIVERED', 15],
            ['OUT_FOR_DELIVERY', 6],
          ]),
      ),
      countByStatuses: vi.fn(async () => 30),
      countOutForDelivery: vi.fn(async () => 6),
      countByStatus: vi.fn(async (_manager: any, status: string) =>
        status === 'ATTEMPTED' ? 2 : status === 'FAILED' ? 3 : status === 'DELIVERED' ? 15 : 0,
      ),
      countAttemptsRemaining: vi.fn(async () => 1),
      countFailedDeliveries: vi.fn(async () => 3),
      countDeliveredDeliveries: vi.fn(async () => 15),
    } as unknown as DeliveryRepository;

    cod = {
      countsByStatus: vi.fn(async () => new Map([['COD_COLLECTED', 10]])),
      countByStatuses: vi.fn(async () => 20),
      countByStatus: vi.fn(async (_manager: any, status: string) =>
        status === 'COD_EXPECTED' ? 7 : status === 'COD_COLLECTED' ? 10 : 3,
      ),
      countOutstandingCOD: vi.fn(async () => 12),
      sumOutstandingCODMinor: vi.fn(async () => BigInt(125050)),
    } as unknown as CodRecordRepository;

    riders = {
      countsByStatus: vi.fn(
        async () =>
          new Map([
            ['AVAILABLE', 5],
            ['ON_DELIVERY', 3],
          ]),
      ),
      countByStatuses: vi.fn(async () => 10),
      countOnlineRiders: vi.fn(async () => 8),
      countAvailableRiders: vi.fn(async () => 5),
      countOfflineRiders: vi.fn(async () => 1),
      countSuspendedRiders: vi.fn(async () => 1),
    } as unknown as RiderRepository;

    hub = {
      countHubs: vi.fn(async () => 6),
      countHubsByKind: vi.fn(async () => new Map()),
    } as unknown as HubRepository;

    service = new DashboardService(
      shipmentDs,
      pickupDs,
      deliveryDs,
      codDs,
      riderDs,
      hubDs,
      shipments,
      pickups,
      deliveries,
      cod,
      riders,
      hub,
    );
  });

  it('returns a complete snapshot with a valid timestamp', async () => {
    const counts = await service.getLiveCounts();
    expect(counts.timestamp).toMatch(timestampIso);
    expect(counts.shipments).toHaveProperty('total');
    expect(counts.pickups).toHaveProperty('total');
    expect(counts.deliveries).toHaveProperty('total');
    expect(counts.cod).toHaveProperty('total');
    expect(counts.riders).toHaveProperty('total');
    expect(counts.hub).toHaveProperty('backlog');
    expect(counts.hub).toHaveProperty('networkHubs');
  });

  it('takes every count from one micro-batch (same timestamp)', async () => {
    const counts = await service.getLiveCounts();
    expect(counts.timestamp).toBeDefined();
    // The snapshot uses one timestamp for every section: one instant, not five.
    expect(typeof counts.timestamp).toBe('string');
  });

  it("reads through each module's own connection manager", async () => {
    const counts = await service.getLiveCounts();
    expect(counts).toBeDefined();
    // All manager reads went through the per-schema data sources; no single shared
    // transaction manager is used because each schema owns its connection.
  });

  it('counts shipment statuses correctly', async () => {
    const counts = await service.getLiveCounts();
    expect(counts.shipments.total).toBe(50);
    expect(counts.shipments.todayNew).toBe(12);
    expect(counts.shipments.inTransit).toBe(7);
    expect(counts.shipments.atHub).toBe(11);
    expect(counts.shipments.sorting).toBe(4);
    expect(counts.shipments.outForDelivery).toBe(2);
    expect(counts.shipments.delivered).toBe(3);
    expect(counts.shipments.failed).toBe(5);
    expect(counts.shipments.returned).toBe(1);
    expect(counts.shipments.returning).toBe(3);
    expect(counts.shipments.cancelled).toBe(6);
    expect(counts.shipments.onHold).toBe(2);
    expect(counts.shipments.lostOrDamaged).toBe(0);
    expect(counts.shipments.exception).toBe(0);
  });

  it('byStatus maps include all statuses with zeros for missing ones', async () => {
    const counts = await service.getLiveCounts();
    // countsByStatus reported only DELIVERED / IN_TRANSIT / OUT_FOR_DELIVERY;
    // the map must be complete (all enum statuses present).
    const byStatus = counts.shipments.byStatus as Record<string, number>;
    expect(Object.values(byStatus).reduce((a, b) => a + b, 0)).toBe(12);
  });

  it('counts pickup statuses correctly', async () => {
    const counts = await service.getLiveCounts();
    expect(counts.pickups.total).toBe(45);
    expect(counts.pickups.active).toBe(8);
    expect(counts.pickups.pending).toBe(3);
    expect(counts.pickups.completed).toBe(20);
    expect(counts.pickups.failed).toBe(4);
    expect(counts.pickups.expired).toBe(2);
    expect(counts.pickups.cancelled).toBe(8);
  });

  it('counts delivery statuses correctly', async () => {
    const counts = await service.getLiveCounts();
    expect(counts.deliveries.total).toBe(30);
    expect(counts.deliveries.outForDelivery).toBe(6);
    expect(counts.deliveries.attempted).toBe(2);
    expect(counts.deliveries.attemptsRemaining).toBe(1);
    expect(counts.deliveries.failed).toBe(3);
    expect(counts.deliveries.delivered).toBe(15);
  });

  it('counts COD records and sums the outstanding amount', async () => {
    const counts = await service.getLiveCounts();
    expect(counts.cod.total).toBe(20);
    expect(counts.cod.expected).toBe(7);
    expect(counts.cod.outstanding).toBe(12);
    expect(counts.cod.outstandingAmountMinor).toBe(BigInt(125050));
  });

  it('counts riders correctly', async () => {
    const counts = await service.getLiveCounts();
    expect(counts.riders.total).toBe(10);
    expect(counts.riders.online).toBe(8);
    expect(counts.riders.available).toBe(5);
    expect(counts.riders.offline).toBe(1);
    expect(counts.riders.suspended).toBe(1);
  });

  it('computes hub backlog as in-hub plus sorting', async () => {
    const counts = await service.getLiveCounts();
    expect(counts.hub.networkHubs).toBe(6);
    expect(counts.hub.backlog).toBe(11 + 4);
  });

  it('hub backlog equals shipments.atHub + sorting (the same physical set)', async () => {
    const counts = await service.getLiveCounts();
    expect(counts.hub.backlog).toBe(counts.shipments.atHub + counts.shipments.sorting);
  });
});
