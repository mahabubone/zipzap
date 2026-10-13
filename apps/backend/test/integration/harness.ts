/**
 * Shared wiring for the integration suites.
 *
 * These tests import from `dist/` because node:test cannot load decorators, which means they cannot
 * use Nest's DI container either — every service is constructed by hand, in a `before` hook, from
 * its real dependencies. That is a deliberate trade: a hand-wired graph against a real Postgres
 * proves things a mocked container cannot (that a transaction rolls back, that a unique constraint
 * resolves a race, that a trigger rejects an UPDATE).
 *
 * The cost is that adding a constructor parameter silently breaks every suite that builds the
 * service by hand. `MERCHANT_PLAN_LOOKUP` was added to `PricingService` as a third parameter and
 * four suites kept calling `new PricingService(pricingDb, new PricingRepository())`. TypeScript
 * did not catch it — the third parameter is optional in the emitted `.d.ts` shape these files
 * consume — and every shipment-creating test failed at runtime with
 * `Cannot read properties of undefined (reading 'planFor')`, while `pnpm test` stayed green
 * because the unit suites do not touch this path.
 *
 * So the construction lives here, once. A fourth file wanting a pricing quote imports
 * `buildPricingService` instead of repeating the argument list, and a signature change becomes one
 * edit with four compile errors instead of four silent runtime failures.
 */

import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { DeliveryProofEntity } from '../../dist/modules/delivery/delivery-proof.entity.js';
import { PricingService } from '../../dist/modules/pricing/pricing.service.js';
import { PricingRepository } from '../../dist/modules/pricing/pricing.repository.js';
import { PricingVersionEntity } from '../../dist/modules/pricing/pricing-version.entity.js';
import { MerchantEntity } from '../../dist/modules/merchant/merchant.entity.js';
import { HubScanService } from '../../dist/modules/hub/hub-scan.service.js';
import { HubRepository } from '../../dist/modules/hub/hub.repository.js';
import { ShipmentLookup } from '../../dist/modules/shipment/shipment.lookup.js';
import { ShipmentRepository } from '../../dist/modules/shipment/shipment.repository.js';
import { ShipmentEntity } from '../../dist/modules/shipment/shipment.entity.js';
import { ShipmentAdvanceService } from '../../dist/modules/shipment/advance-shipment.service.js';
import { AppendTrackingEventService } from '../../dist/modules/tracking/append-tracking-event.service.js';
import { TrackingEventEntity } from '../../dist/modules/tracking/tracking-event.entity.js';
import { PublicTimelineEntity } from '../../dist/modules/tracking/public-timeline.entity.js';
import { CreateSettlementService } from '../../dist/modules/finance/create-settlement.service.js';
import { FinanceRepository } from '../../dist/modules/finance/finance.repository.js';
import { OfflineSyncService } from '../../dist/modules/rider/offline-sync.service.js';
import { CommandQueueRepository } from '../../dist/modules/rider/command-queue.repository.js';
import { RiderRepository } from '../../dist/modules/rider/rider.repository.js';

export interface PricingHarness {
  readonly service: PricingService;
  /** Pricing's own schema. Destroy it in `after`, like every other connection. */
  readonly db: DataSource;
  /** The merchant schema connection, owned by this harness rather than by the caller. */
  readonly merchantDb: DataSource;
}

/**
 * A stand-in for the real `MerchantPlanLookup`.
 *
 * It is a lookup over a table the test does not otherwise need, so it answers from a map instead of
 * opening a second connection. The production contract is explicit that an unknown merchant
 * returns `'standard'` rather than null — this mirrors that, so a test that quotes for a merchant
 * it never created gets the same answer it would get in production rather than a crash.
 */
export class StubPlanLookup {
  private readonly plans = new Map<string, string>();

  /** Set a merchant onto a named plan, to exercise the discount path. */
  set(merchantId: string, plan: string): void {
    this.plans.set(merchantId, plan);
  }

  async planFor(merchantId: string): Promise<string> {
    return this.plans.get(merchantId) ?? 'standard';
  }
}

/**
 * Pricing, wired the way the module graph wires it.
 *
 * `merchantDb` is opened and returned rather than closed here so a test that needs to assert on
 * merchant rows can, and so the lifecycle stays with the `before`/`after` that owns it.
 */
export async function buildPricingService(): Promise<PricingHarness> {
  const db = await connectModuleDataSource('pricing', [PricingVersionEntity]);
  const merchantDb = await connectModuleDataSource('merchant', [MerchantEntity]);
  return {
    service: new PricingService(db, new PricingRepository(), new StubPlanLookup()),
    db,
    merchantDb,
  };
}

export interface HubScanHarness {
  readonly service: HubScanService;
  readonly hubDb: DataSource;
  readonly shipmentDb: DataSource;
  readonly trackingDb: DataSource;
}

/**
 * The hub scan, wired with all five of its dependencies.
 *
 * It had drifted to three: `HubRepository` and `SHIPMENT_LOOKUP` were added after these suites
 * were written, and every hub scan then died on `Cannot read properties of undefined (reading
 * 'findByCode')` — the same failure shape as the pricing one, from the same cause. `hub` asking
 * `shipment` for a tracking code rather than joining `shipment.shipments` is rule 2 working
 * correctly, which is why the lookup has to be present in the graph at all.
 */
export async function buildHubScan(): Promise<HubScanHarness> {
  const hubDb = await connectModuleDataSource('hub', []);
  const shipmentDb = await connectModuleDataSource('shipment', [ShipmentEntity]);
  const trackingDb = await connectModuleDataSource('tracking', [
    TrackingEventEntity,
    PublicTimelineEntity,
  ]);

  const tracking = new AppendTrackingEventService();
  const shipments = new ShipmentRepository();
  const advance = new ShipmentAdvanceService(shipmentDb, shipments, tracking);

  return {
    service: new HubScanService(
      hubDb,
      advance,
      tracking,
      new HubRepository(),
      new ShipmentLookup(shipmentDb, shipments),
    ),
    hubDb,
    shipmentDb,
    trackingDb,
  };
}

export interface SettlementHarness {
  readonly service: CreateSettlementService;
  readonly db: DataSource;
}

/**
 * Settlement creation, wired with its settlement blocker.
 *
 * `CreateSettlementService` gained a third dependency — `COD_LOOKUP`, the contract that answers
 * "does this merchant still have uncollected cash?" — so a settlement cannot be created against
 * money that has not landed. Dropping it made the service construct happily and then freeze
 * nothing at all, which is the worst shape of drift: a test that passes while asserting less than
 * it was written to.
 */
export async function buildSettlement(
  blocker: SettlementBlocker = new NoBlockers(),
): Promise<SettlementHarness> {
  const db = await connectModuleDataSource('finance', []);
  return { service: new CreateSettlementService(db, new FinanceRepository(), blocker), db };
}

/** The contract `CreateSettlementService` needs — the two blocker reads, and nothing else. */
export interface SettlementBlocker {
  blocksFor(merchantId: string): Promise<Map<string, number>>;
  reviewedMismatches(merchantId: string): Promise<string[]>;
}

/** Nothing is outstanding, so settlement is not blocked. */
export class NoBlockers implements SettlementBlocker {
  async blocksFor(): Promise<Map<string, number>> {
    return new Map();
  }

  async reviewedMismatches(): Promise<string[]> {
    return [];
  }
}

export interface OfflineSyncHarness {
  readonly service: OfflineSyncService;
}

/**
 * Offline sync, wired with its validator map.
 *
 * The map is the fourth parameter and it is not optional in spirit: a command with no validator is
 * a command that cannot be replayed, so the server would accept writes it cannot later prove. The
 * production default is an empty map for convenience at boot; a test that wants replay to be
 * meaningful must pass the real validator, which is why this takes it as an argument rather than
 * hiding it.
 */
export async function buildOfflineSync(
  validators: Record<string, Validator>,
): Promise<OfflineSyncHarness> {
  const ds = await connectModuleDataSource('rider', []);
  return {
    service: new OfflineSyncService(
      ds,
      new CommandQueueRepository(),
      new RiderRepository(),
      validators,
    ),
  };
}

/** One replayable command's validator. Mirrors the production contract. */
export interface Validator {
  validate(command: unknown): Promise<void>;
}

/**
 * Record a VERIFIED proof of delivery for a job.
 *
 * `AdvanceDeliveryService.complete` refuses to mark a parcel delivered without one — that check is
 * the feature, not an obstacle to it: every route to `DELIVERED` passes through it, so a rider
 * tapping "delivered" on a bare status change stops working and the customer gets a delivery with a
 * name, a photo and a location behind it.
 *
 * These story suites predate that rule and had no way to satisfy it, so they failed with
 * `PROOF_REQUIRED` on every delivery. Rather than have each of them hand-assemble a proof row —
 * the same drift this file exists to stop — they call this, which writes one VERIFIED row per job.
 *
 * The code hash is a real SHA-256 of `salt:code`, because the column stores the hash and a fake
 * value would make a test that "verifies a code" assert against something production never reads.
 */
export async function recordVerifiedProof(
  db: DataSource,
  jobId: string,
  riderId: string,
  code = '123456',
): Promise<void> {
  const salt = randomUUID();
  await db.transaction(async (manager) => {
    const repo = manager.getRepository(DeliveryProofEntity);
    await repo.save(
      repo.create({
        id: randomUUID(),
        jobId,
        codeHash: createHash('sha256').update(`${salt}:${code}`).digest('hex'),
        codeSalt: salt,
        codeIssuedAt: new Date(),
        codeExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        attemptsUsed: 1,
        status: 'VERIFIED',
        otpVerifiedAt: new Date(),
        photoSha256: createHash('sha256').update('proof-photo').digest('hex'),
        photoContentType: 'image/jpeg',
        photoByteLength: 2048,
        // The bytes, not just their fingerprint. `delivery_proofs_verified_is_complete` refuses a
        // VERIFIED row whose `photo_data` is NULL — "a proof without the photo" is the exact lie
        // the constraint exists to prevent, so a fixture that set only the hash would be rejected
        // by the same rule the production path obeys. Two KB of noise, never decoded by a test.
        photoData: Buffer.alloc(2048, 0x2a),
        latitude: 23.8103,
        longitude: 90.4125,
        capturedBy: riderId,
      } as DeliveryProofEntity),
    );
  });
}
