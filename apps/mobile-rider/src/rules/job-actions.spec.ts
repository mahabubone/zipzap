/**
 * What the rider may do, and what the app therefore offers.
 *
 * These tests exist for the property the rider app lacked: it offered actions the state machine
 * would refuse. The hub console carries the same property and proves it the same way — every offered
 * action is legal in the current state, and every illegal one is absent.
 */

import { describe, expect, it } from 'vitest';
import { actionsFor, isFinalAttempt, primaryAction, secondaryActions } from './job-actions.ts';
import type { JobRow } from '../screens/JobsScreen.tsx';

function pickup(status: string): JobRow {
  return {
    key: 'p-1',
    kind: 'pickup',
    id: 'p-1',
    shipmentId: 'shp-1',
    title: 'Pickup 2 parcels',
    status,
    detail: '2000g · 2 shipments',
    createdAt: '2026-10-11T08:00:00.000Z',
  };
}

function delivery(status: string, attemptsMade = 0): JobRow {
  return {
    key: 'd-1',
    kind: 'delivery',
    id: 'd-1',
    shipmentId: 'shp-1',
    title: 'Delivery 77777777',
    status,
    detail: attemptsMade > 0 ? `Attempt ${attemptsMade}` : 'Not yet attempted',
    createdAt: '2026-10-11T08:00:00.000Z',
  };
}

describe('a pickup', () => {
  it('offers exactly one action, and it is the scan', () => {
    const actions = actionsFor(pickup('ASSIGNED'));

    expect(actions.map((a) => a.id)).toEqual(['scan']);
    expect(actions[0]?.weight).toBe('primary');
  });

  it('offers nothing once the parcels have been taken', () => {
    expect(actionsFor(pickup('PICKED_UP'))).toEqual([]);
  });

  it('offers nothing for a completed pickup', () => {
    expect(actionsFor(pickup('COMPLETED'))).toEqual([]);
  });

  it('never offers a failure path, because there is no failure at a shop door', () => {
    expect(actionsFor(pickup('ASSIGNED')).some((a) => a.id === 'fail')).toBe(false);
  });
});

describe('a delivery', () => {
  it('promotes proof over failure', () => {
    // A door where the customer is in is the normal case. The primary action must be the normal one,
    // or the rider learns to distrust the big button.
    expect(primaryAction(delivery('OUT_FOR_DELIVERY'))?.id).toBe('deliver');
    expect(secondaryActions(delivery('OUT_FOR_DELIVERY')).map((a) => a.id)).toEqual(['fail']);
  });

  it('promotes failure after an attempt', () => {
    expect(primaryAction(delivery('ATTEMPTED', 1))?.id).toBe('fail');
  });

  it('offers nothing for a delivered job', () => {
    expect(actionsFor(delivery('DELIVERED'))).toEqual([]);
  });

  it('offers nothing for a failed job, because returns owns it now', () => {
    expect(actionsFor(delivery('FAILED'))).toEqual([]);
  });

  it('offers exactly one primary action, never two', () => {
    for (const status of ['OUT_FOR_DELIVERY', 'ACCEPTED', 'ASSIGNED', 'ATTEMPTED']) {
      const actions = actionsFor(delivery(status, 1));
      expect(actions.filter((a) => a.weight === 'primary')).toHaveLength(1);
    }
  });
});

describe('a status this client does not know', () => {
  it('offers nothing rather than guessing', () => {
    // The fail-closed direction: an unknown state may be one the server has a transition to that
    // this build predates, and letting the server speak is safer than an optimistic button.
    const unknown: JobRow = { ...delivery('OUT_FOR_DELIVERY'), status: 'TELEPORTED_BY_TECHNOLOGY' };
    expect(actionsFor(unknown)).toEqual([]);
  });
});

describe('isFinalAttempt', () => {
  it('is not final on the first attempt', () => {
    expect(isFinalAttempt(0)).toBe(false);
  });

  it('is final on the third, which is what hands the parcel to returns', () => {
    expect(isFinalAttempt(2)).toBe(true);
  });
});
