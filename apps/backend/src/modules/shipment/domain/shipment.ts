/**
 * Shipment aggregate. Framework-free.
 *
 * The aggregate is the authority on its own state. It validates transitions, never trusts a
 * caller to have checked, and exposes no way to set a status directly.
 */

import { randomBytes } from 'node:crypto';
import { money, type Money } from '../../../common/money.ts';
import { assertTransition, type ShipmentStatus } from './state-machine.ts';

export interface Address {
  readonly name: string;
  readonly phone: string;
  readonly line: string;
}

export interface Parcel {
  readonly weightGrams: number;
  readonly description: string;
}

export interface Shipment {
  readonly id: string;
  readonly trackingCode: string;
  readonly merchantId: string;
  readonly sender: Address;
  readonly recipient: Address;
  readonly parcel: Parcel;
  readonly cod: Money;
  readonly status: ShipmentStatus;
  /** The state ON_HOLD interrupted, so release can resume exactly. */
  readonly heldFromStatus: ShipmentStatus | null;
  readonly pricingVersion: number;
  readonly createdAt: Date;
}

/**
 * Tracking codes are non-sequential and non-guessable. `ZP8F32A1BD` must not be derivable —
 * a guessable code on a public endpoint is a customer-address enumeration vector.
 *
 * Crockford base32 excludes I, L, O and U so a code read aloud or typed from a label is
 * unambiguous.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateTrackingCode(prefix = 'ZP', length = 10): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += ALPHABET[(bytes[index] ?? 0) % ALPHABET.length];
  }
  return `${prefix}-${code}`;
}

export interface CreateShipmentInput {
  readonly id: string;
  readonly merchantId: string;
  readonly sender: Address;
  readonly recipient: Address;
  readonly parcel: Parcel;
  readonly cod?: Money;
  readonly pricingVersion?: number;
  readonly trackingCode?: string;
  readonly now?: Date;
}

export function createShipment(input: CreateShipmentInput): Shipment {
  return {
    id: input.id,
    trackingCode: input.trackingCode ?? generateTrackingCode(),
    merchantId: input.merchantId,
    sender: input.sender,
    recipient: input.recipient,
    parcel: input.parcel,
    cod: input.cod ?? money(0),
    status: 'DRAFT',
    heldFromStatus: null,
    pricingVersion: input.pricingVersion ?? 1,
    createdAt: input.now ?? new Date(),
  };
}

export function transition(shipment: Shipment, to: ShipmentStatus): Shipment {
  assertTransition(shipment.status, to);

  // Hold remembers where to resume; leaving hold does not guess.
  if (to === 'ON_HOLD') {
    return { ...shipment, status: 'ON_HOLD', heldFromStatus: shipment.status };
  }

  return { ...shipment, status: to, heldFromStatus: null };
}

/** Resume from ON_HOLD to the state that was interrupted. */
export function release(shipment: Shipment): Shipment {
  if (shipment.status !== 'ON_HOLD' || shipment.heldFromStatus === null) {
    throw new Error(`release is only valid from ON_HOLD with a recorded prior state`);
  }
  return { ...shipment, status: shipment.heldFromStatus, heldFromStatus: null };
}
