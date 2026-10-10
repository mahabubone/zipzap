import { describe, expect, it } from 'vitest';
import { AdvanceDeliveryService } from './advance-delivery.service.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { ProofRequiredError } from '../../common/domain-error.ts';

/**
 * The gate on `complete`: a parcel cannot become DELIVERED without a proof behind it.
 *
 * This is the rule that turns proof-of-delivery from a screen into a guarantee. If it regresses,
 * nothing else in the system notices — the delivery still succeeds, the customer still gets an SMS,
 * and the only visible difference is that the evidence quietly stopped being collected.
 */

const COMMAND = { collectedMinor: 1250, idempotencyKey: 'k-1', actorId: 'rider-1' };

function makeService(options: { verifiedProof: unknown; codAmountMinor: number | null }) {
  const writes: string[] = [];
  let shipmentStatus = 'OUT_FOR_DELIVERY';

  const manager = { query: () => Promise.resolve([]) };
  const dataSource = { transaction: (fn: (m: unknown) => Promise<unknown>) => fn(manager) };

  const jobs = {
    findByIdForUpdate: () =>
      Promise.resolve({
        id: 'job-1',
        shipmentId: 'ship-1',
        riderId: 'rider-1',
        status: 'OUT_FOR_DELIVERY',
        attemptsMade: 0,
      }),
    findVerifiedProof: () => Promise.resolve(options.verifiedProof),
    save: (_m: unknown, entity: { status: string }) => {
      writes.push(`job:${entity.status}`);
      return Promise.resolve(entity);
    },
  };

  const shipments = {
    findMerchantId: () => Promise.resolve('merchant-1'),
    findCodAmount: () =>
      Promise.resolve(
        options.codAmountMinor === null
          ? null
          : { amountMinor: options.codAmountMinor, currency: 'BDT' },
      ),
  };

  const advance = {
    statuses: () => Promise.resolve({ 'ship-1': shipmentStatus }),
    advance: (_m: unknown, _id: string, to: string) => {
      writes.push(`shipment:${to}`);
      shipmentStatus = to;
      return Promise.resolve(to);
    },
  };

  const cod = {
    execute: () => {
      writes.push('cod:collect');
      return Promise.resolve({ collectedMinor: COMMAND.collectedMinor });
    },
  };

  return {
    service: new AdvanceDeliveryService(
      dataSource as never,
      jobs as never,
      new AppendTrackingEventService() as never,
      shipments as never,
      advance as never,
      cod as never,
    ),
    writes,
  };
}

const VERIFIED_PROOF = {
  otpVerifiedAt: new Date('2026-10-10T08:00:00Z'),
  photoSha256: 'a'.repeat(64),
  latitude: 23.81,
  longitude: 90.41,
};

describe('AdvanceDeliveryService.complete', () => {
  it('refuses to deliver a parcel that has no proof', async () => {
    const { service, writes } = makeService({ verifiedProof: null, codAmountMinor: null });

    await expect(service.complete('job-1', COMMAND)).rejects.toBeInstanceOf(ProofRequiredError);
    // Nothing moved: not the job, not the parcel, not COD. A rejected delivery must leave no trace
    // that a later retry could mistake for progress.
    expect(writes).toEqual([]);
  });

  it('delivers once a proof exists', async () => {
    const { service, writes } = makeService({
      verifiedProof: VERIFIED_PROOF,
      codAmountMinor: null,
    });

    const status = await service.complete('job-1', COMMAND);

    expect(status).toBe('DELIVERED');
    expect(writes).toContain('job:ATTEMPTED');
    expect(writes).toContain('job:DELIVERED');
    expect(writes).toContain('shipment:DELIVERED');
  });

  it('collects COD in the same transaction as the delivery it proved', async () => {
    const { service, writes } = makeService({
      verifiedProof: VERIFIED_PROOF,
      codAmountMinor: 1250,
    });

    await service.complete('job-1', COMMAND);

    expect(writes).toContain('cod:collect');
  });
});
