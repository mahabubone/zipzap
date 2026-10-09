/**
 * Validators for the offline command queue.
 *
 * Each answers one question: *does this command still apply, given what is true now?* A `false`
 * is never a silent drop — it is recorded with a reason the rider can read on their phone, which
 * is the whole contract of ADR-0012. "A shipment cancelled while the device was offline must not
 * be silently dropped" means exactly this: the parcel is not scanned, and the rider is told why.
 *
 * Framework-free apart from the injected lookup token, and registered per command type by the
 * module so the queue itself never has to know what a "delivery" means.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { PendingCommandRow } from './command-queue.repository.ts';
import { RiderEntity } from './rider.entity.ts';
import { SHIPMENT_LOOKUP, type ShipmentLookup } from '../shipment/shipment.lookup.ts';
import type { ValidateResult, Validator } from './offline-sync.service.ts';

/**
 * Rider status only. The original validator, and still the right one for a command that is about
 * the rider rather than a parcel ("I am going offline", "I am on break").
 */
export const RIDER_STATUS_VALIDATOR: Validator = async (
  manager: EntityManager,
  command: PendingCommandRow,
): Promise<ValidateResult> => {
  const expected = (command.expected_state as { status?: string } | null)?.status;
  if (!expected) return { valid: true };

  const rider = await manager.getRepository(RiderEntity).findOneBy({ id: command.rider_id });
  if (!rider) return { valid: false, reason: 'rider not found' };
  if (rider.status !== expected) {
    return { valid: false, reason: `expected status ${expected}, rider is ${rider.status}` };
  }
  return { valid: true };
};

/**
 * A command about one parcel: a pickup scan, a delivery, a COD collection.
 *
 * The device recorded `expected_state.shipmentStatus` — what it believed when the rider pressed
 * the button, offline. The server compares that against the shipment *now*. This is the check that
 * makes an offline day safe rather than merely deferred: a parcel cancelled or delivered by someone
 * else in the meantime is rejected with a reason, and never applied retroactively over a state it
 * did not observe.
 *
 * Reading the status goes through `SHIPMENT_LOOKUP`, not the shipment connection (rule 2), and an
 * unknown id is a rejection rather than a pass — a command about a parcel this server has never
 * heard of cannot be confirmed to apply.
 */
// Not `implements Validator`: that type is a bare function, and this one needs an injected lookup to
// exist at all. The module binds `validate` below into the registry instead of the instance.
@Injectable()
export class ShipmentStateValidator {
  constructor(@Inject(SHIPMENT_LOOKUP) private readonly shipments: ShipmentLookup) {}

  async validate(_manager: EntityManager, command: PendingCommandRow): Promise<ValidateResult> {
    const expected = command.expected_state as {
      shipmentId?: string;
      shipmentStatus?: string;
    } | null;
    if (!expected?.shipmentId) return { valid: true };

    const current = await this.shipments.currentStatus(expected.shipmentId);
    if (current === null) {
      return { valid: false, reason: `shipment ${expected.shipmentId} not found` };
    }
    if (!expected.shipmentStatus) return { valid: true };
    if (current !== expected.shipmentStatus) {
      return {
        valid: false,
        reason: `expected status ${expected.shipmentStatus}, shipment is ${current}`,
      };
    }
    return { valid: true };
  }
}
