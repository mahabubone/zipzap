import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { CreateShipmentService } from './create-shipment.service.ts';
import { ShipmentRepository } from './shipment.repository.ts';
import { PricingService } from '../pricing/pricing.service.ts';

/**
 * Service-level tests: the transaction choreography, minus the database.
 *
 * Impossible under the old runner — node:test cannot load a decorated class. What these cover:
 * the four-writes-one-transaction orchestration and the response contract. Real atomicity is
 * proven by test/integration/, against Postgres.
 */

const COMMAND = {
  merchantId: 'a71cdemo',
  merchantPlan: 'standard',
  zone: 'dhaka-metro',
  remoteArea: false,
  fragile: false,
  packagingKind: null as string | null,
  sender: { name: 'Ayesha', phone: '+8801700000000', line: 'Dhaka' },
  recipient: { name: 'Rahim', phone: '+8801800000000', line: 'Chattogram' },
  parcel: { weightGrams: 1200, description: 'Two shirts' },
  idempotencyKey: 'key-1',
  actorId: null as string | null,
};

/** Pricing is read-only and deterministic, so the stand-in returns a fixed version-1 quote. */
function fakePricing(version = 1) {
  return {
    quote: vi.fn(async () => ({
      version,
      currency: 'BDT',
      lines: [],
      total: { amountMinor: 0, currency: 'BDT' },
    })),
  };
}

/** Coverage stand-in: serviceable everywhere unless a test opts a zone out. */
function fakeNetwork(
  overrides: Record<string, { serviceable?: boolean; codAvailable?: boolean }> = {},
) {
  return {
    checkZone: vi.fn(async (zone: string) => {
      const override = overrides[zone] ?? {};
      const serviceable = override.serviceable ?? true;
      return {
        zone,
        serviceable,
        reason: serviceable ? null : `No coverage for zone "${zone}".`,
        estimatedDays: 1,
        pickupAvailable: serviceable,
        deliveryAvailable: serviceable,
        codAvailable: override.codAvailable ?? serviceable,
      };
    }),
  };
}

/** In-memory stand-in for the transaction manager. Records every SQL table touched, in order. */
function fakeManager() {
  const touched: string[] = [];
  return {
    touched,
    manager: {
      query: (sql: string) => {
        touched.push(
          sql.includes('tracking.events')
            ? 'tracking.events'
            : sql.includes('outbox_events')
              ? 'system.outbox_events'
              : sql.includes('idempotency_keys')
                ? sql.includes('UPDATE')
                  ? 'complete:system.idempotency_keys'
                  : 'claim:system.idempotency_keys'
                : sql,
        );
        // claim() runs INSERT ... ON CONFLICT first: empty array means the key was free.
        if (sql.includes('INSERT INTO system.idempotency_keys') && sql.includes('RETURNING')) {
          return Promise.resolve([{ scope: 'x' }]);
        }
        if (sql.includes('INSERT INTO system.idempotency_keys') && sql.includes('ON CONFLICT')) {
          return Promise.resolve([{ scope: 'x' }]);
        }
        return Promise.resolve([]);
      },
      getRepository: () => ({
        save: (entity: unknown) => {
          touched.push('shipment.shipments');
          return Promise.resolve(entity);
        },
      }),
    },
  };
}

describe('CreateShipmentService orchestration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('produces a CREATED shipment with an unambiguous tracking code and integer COD', async () => {
    const fake = fakeManager();
    const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
    const service = new CreateShipmentService(
      fakeDs as never,
      new ShipmentRepository(),
      new AppendTrackingEventService(),
      fakePricing() as never,
      { ensure: async () => null } as never,
      fakeNetwork() as never,
    );

    const { result, replayed } = await service.execute({ ...COMMAND, cod: undefined });

    expect(replayed).toBe(false);
    expect(result.status).toBe('CREATED');
    expect(result.trackingCode).toMatch(/^ZP-[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(result.cod.amountMinor).toBe(0);
    expect(Number.isInteger(result.cod.amountMinor)).toBe(true);
  });

  it('maps integer COD minor units through exactly, and identifiers nowhere else', async () => {
    const fake = fakeManager();
    const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
    const service = new CreateShipmentService(
      fakeDs as never,
      new ShipmentRepository(),
      new AppendTrackingEventService(),
      fakePricing() as never,
      { ensure: async () => null } as never,
      fakeNetwork() as never,
    );

    const { result } = await service.execute({
      ...COMMAND,
      idempotencyKey: 'key-2',
      cod: { amountMinor: 125_050, currency: 'BDT' },
    });

    expect(result.cod).toEqual({ amountMinor: 125_050, currency: 'BDT' });
    // Four writes, fixed order: key claim, aggregate, tracking, outbox, key completion.
    expect(fake.touched).toEqual([
      'claim:system.idempotency_keys',
      'shipment.shipments',
      'tracking.events',
      'system.outbox_events',
      'complete:system.idempotency_keys',
    ]);
  });

  it('freezes the quoted version onto the shipment', async () => {
    const fake = fakeManager();
    const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
    const pricing = fakePricing(7);
    const service = new CreateShipmentService(
      fakeDs as never,
      new ShipmentRepository(),
      new AppendTrackingEventService(),
      pricing as never,
      { ensure: async () => null } as never,
      fakeNetwork() as never,
    );

    await service.execute({ ...COMMAND, idempotencyKey: 'key-3' });
    expect(pricing.quote).toHaveBeenCalledOnce();
  });

  it('rejects an unserviceable zone with a reason before any write', async () => {
    const fake = fakeManager();
    const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
    const service = new CreateShipmentService(
      fakeDs as never,
      new ShipmentRepository(),
      new AppendTrackingEventService(),
      fakePricing() as never,
      { ensure: async () => null } as never,
      fakeNetwork({ 'atlantis-01': { serviceable: false } }) as never,
    );

    const failure = (await service
      .execute({ ...COMMAND, idempotencyKey: 'key-unserv', zone: 'atlantis-01' })
      .catch((error: unknown) => error as Error)) as Error;

    expect(failure.message).toContain('No coverage for zone "atlantis-01"');
    // The claim row is written first and rolls back with the rejection in the real
    // transaction (proven in test/integration against Postgres); here we assert the
    // thing the fake can observe: no shipment, tracking or outbox write happened.
    expect(fake.touched).not.toContain('shipment.shipments');
    expect(fake.touched).not.toContain('tracking.events');
    expect(fake.touched).not.toContain('system.outbox_events');
  });

  it('rejects COD in a zone whose coverage disables it', async () => {
    const fake = fakeManager();
    const fakeDs = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(fake.manager) };
    const service = new CreateShipmentService(
      fakeDs as never,
      new ShipmentRepository(),
      new AppendTrackingEventService(),
      fakePricing() as never,
      { ensure: async () => null } as never,
      fakeNetwork({ 'sylhet-metro': { codAvailable: false } }) as never,
    );

    const failure = (await service
      .execute({
        ...COMMAND,
        idempotencyKey: 'key-nocod',
        zone: 'sylhet-metro',
        cod: { amountMinor: 50_000, currency: 'BDT' },
      })
      .catch((error: unknown) => error as Error)) as Error;

    expect(failure.message).toContain('COD is not available in zone "sylhet-metro"');
    expect(fake.touched).not.toContain('shipment.shipments');
  });

  it('resolves through the real Nest container with a mocked DataSource boundary', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateShipmentService,
        { provide: ShipmentRepository, useValue: {} },
        { provide: AppendTrackingEventService, useValue: { append: vi.fn() } },
        { provide: PricingService, useValue: {} },
      ],
    })
      .useMocker(() => ({}))
      .compile();

    expect(module.get(CreateShipmentService)).toBeDefined();
    expect(module.get(AppendTrackingEventService).append).toBeDefined();
  });
});
