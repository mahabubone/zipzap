import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SHIPMENT_STATUSES,
  TRANSITIONS,
  TERMINAL_STATUSES,
  allowedFrom,
  assertTransition,
  canTransition,
  isForwardTerminal,
  isTerminal,
  type ShipmentStatus,
} from '../src/modules/shipment/domain/state-machine.ts';
import {
  createShipment,
  generateTrackingCode,
  release,
  transition,
  type Shipment,
} from '../src/modules/shipment/domain/shipment.ts';

function drive(shipment: Shipment, path: readonly ShipmentStatus[]): Shipment {
  return path.reduce(transition, shipment);
}
import { InvalidTransitionError } from '../src/common/domain-error.ts';

const ALL = SHIPMENT_STATUSES;

/**
 * Exhaustive: every from x to pair. This is the highest-value test in the repository — a parcel
 * that appears to move twice, or a COD collected against a shipment nobody delivered, is found
 * here or in a financial dispute six weeks later.
 */
describe('shipment state machine — exhaustive', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      const legal = (TRANSITIONS[from] as readonly ShipmentStatus[]).includes(to);
      test(`${from} -> ${to} is ${legal ? 'allowed' : 'rejected'}`, () => {
        assert.equal(canTransition(from, to), legal);
        if (legal) {
          assert.doesNotThrow(() => assertTransition(from, to));
        } else {
          assert.throws(() => assertTransition(from, to), InvalidTransitionError);
        }
      });
    }
  }
});

describe('shipment state machine — properties', () => {
  test('every status appears in the transition table', () => {
    for (const status of ALL) {
      assert.ok(Array.isArray(allowedFrom(status)), `${status} is missing from TRANSITIONS`);
    }
  });

  test('the table declares no transition to an unknown status', () => {
    for (const from of ALL) {
      for (const to of TRANSITIONS[from] as readonly ShipmentStatus[]) {
        assert.ok(ALL.includes(to), `${from} -> ${to} names a status outside SHIPMENT_STATUSES`);
      }
    }
  });

  test('a terminal status allows no transition at all', () => {
    for (const terminal of TERMINAL_STATUSES) {
      assert.equal(allowedFrom(terminal).length, 0, `${terminal} should be terminal`);
      assert.ok(isTerminal(terminal));
    }
  });

  test('DELIVERED is forward-terminal but can still branch into a return', () => {
    // The distinction is the point. An absolutely-terminal DELIVERED would make a
    // delivered-then-refused parcel unrepresentable, which is a real and common case.
    assert.deepEqual(allowedFrom('DELIVERED'), ['RETURN_INITIATED']);
    assert.ok(isForwardTerminal('DELIVERED'), 'DELIVERED ends the forward path');
    assert.ok(!isTerminal('DELIVERED'), 'but a return may still begin');
  });

  test('the forward path is monotonic, except the documented delivery retry', () => {
    // History is a chain of forward moves. A shipment that was DELIVERED and then RETURNED
    // reached DELIVERED first, so there is no edge that rewinds it.
    //
    // The one exception is RETRY_SCHEDULED -> OUT_FOR_DELIVERY, which re-attempts delivery and
    // therefore goes back out. That is a retry loop, not a rewind, and it is the only one.
    const RETRY_LOOP: ReadonlySet<string> = new Set(['RETRY_SCHEDULED->OUT_FOR_DELIVERY']);

    // Only the linear spine is ranked. Administrative states (ON_HOLD, CANCELLED, LOST, DAMAGED)
    // and the operational catch-all EXCEPTION are not positions on that spine — EXCEPTION can
    // legitimately lead to CANCELLED, which "rewinds" only if you pretend it is linear.
    const SPINE = [
      'DRAFT',
      'CREATED',
      'PICKUP_REQUESTED',
      'PICKUP_ASSIGNED',
      'PICKED_UP',
      'AT_ORIGIN_HUB',
      'SORTING',
      'DISPATCHED',
      'IN_TRANSIT',
      'AT_DESTINATION_HUB',
      'OUT_FOR_DELIVERY',
      'DELIVERY_FAILED',
      'RETRY_SCHEDULED',
      'DELIVERED',
    ] as const satisfies readonly ShipmentStatus[];

    const rank = new Map<string, number>(SPINE.map((status, index) => [status, index]));

    for (const from of SPINE) {
      for (const to of TRANSITIONS[from] as readonly ShipmentStatus[]) {
        if (!rank.has(to)) continue;
        if (RETRY_LOOP.has(`${from}->${to}`)) continue;
        assert.ok(
          rank.get(to)! > rank.get(from)!,
          `${from} (${rank.get(from)}) -> ${to} (${rank.get(to)}) rewinds the spine`,
        );
      }
    }

    // And the spine itself must be walkable, or nothing else matters.
    const walked = SPINE.filter((s) => s !== 'RETRY_SCHEDULED' && s !== 'DELIVERY_FAILED');
    for (let index = 1; index < walked.length; index += 1) {
      assert.ok(
        canTransition(walked[index - 1]!, walked[index]!),
        `the spine is not walkable at ${walked[index - 1]} -> ${walked[index]}`,
      );
    }
  });
});

describe('tracking codes', () => {
  test('are non-sequential and non-guessable', () => {
    const codes = Array.from({ length: 500 }, () => generateTrackingCode());
    assert.equal(new Set(codes).size, 500, 'codes collided');
    // Sequential codes would cluster; random ones should not be contiguous.
    const bodies = codes.map((code) => code.slice(3));
    const sorted = [...bodies].sort();
    let adjacent = 0;
    for (let index = 1; index < sorted.length; index += 1) {
      if (Number.parseInt(sorted[index]!, 36) === Number.parseInt(sorted[index - 1]!, 36) + 1) {
        adjacent += 1;
      }
    }
    assert.ok(adjacent < 20, `${adjacent} adjacent codes suggests a sequential generator`);
  });

  test('exclude ambiguous characters, so a code read aloud is unambiguous', () => {
    const codes = Array.from({ length: 300 }, () => generateTrackingCode());
    for (const code of codes) {
      assert.match(code, /^ZP-[0-9A-HJKMNP-TV-Z]{10}$/, `ambiguous characters in ${code}`);
      assert.ok(!/[ILOU]/.test(code), `${code} contains an easily confused character`);
    }
  });
});

describe('shipment aggregate', () => {
  const input = {
    id: 'b3f1demo',
    merchantId: 'a71cdemo',
    sender: { name: 'Ayesha', phone: '+8801700000000', line: 'Dhaka' },
    recipient: { name: 'Rahim', phone: '+8801800000000', line: 'Chattogram' },
    parcel: { weightGrams: 1200, description: 'Two shirts' },
  };

  test('starts in DRAFT and can only move to CREATED or CANCELLED', () => {
    const shipment = createShipment(input);
    assert.equal(shipment.status, 'DRAFT');
    assert.deepEqual(allowedFrom('DRAFT'), ['CREATED', 'CANCELLED']);
  });

  test('refuses an illegal transition and leaves the aggregate untouched', () => {
    const shipment = createShipment(input);
    assert.throws(() => transition(shipment, 'DELIVERED'), InvalidTransitionError);
    // Immutable: the original is not mutated by a rejected transition.
    assert.equal(shipment.status, 'DRAFT');
  });

  test('ON_HOLD records where to resume, and release returns it exactly', () => {
    const outForDelivery = drive(createShipment(input), [
      'CREATED',
      'PICKUP_REQUESTED',
      'PICKUP_ASSIGNED',
      'PICKED_UP',
      'AT_ORIGIN_HUB',
      'SORTING',
      'DISPATCHED',
      'IN_TRANSIT',
      'AT_DESTINATION_HUB',
      'OUT_FOR_DELIVERY',
    ]);

    const held = transition(outForDelivery, 'ON_HOLD');
    assert.equal(held.status, 'ON_HOLD');
    assert.equal(held.heldFromStatus, 'OUT_FOR_DELIVERY');

    const resumed = release(held);
    assert.equal(resumed.status, 'OUT_FOR_DELIVERY', 'release must resume exactly');
    assert.equal(resumed.heldFromStatus, null);
  });

  test('release is invalid outside ON_HOLD', () => {
    const created = transition(createShipment(input), 'CREATED');
    assert.throws(() => release(created), /only valid from ON_HOLD/);
  });
});
