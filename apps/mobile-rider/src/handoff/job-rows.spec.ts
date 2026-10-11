/**
 * End-to-end proof that R6 closed the gap.
 *
 * The delivery job used to carry a shipment id and nothing else, so a rider was asked to collect
 * cash without being told how much and to call somebody whose number never reached the device. These
 * tests drive the real projection — `toJobRows` over a server-shaped response — and assert both
 * values arrive on the device.
 */

import { describe, expect, it } from 'vitest';
import { toJobRows } from './job-rows.ts';
import type { RiderJobs, ShipmentHandoff } from './job-rows.ts';

function jobsWithHandoff(handoff: ShipmentHandoff | null): RiderJobs {
  return {
    pickups: [],
    deliveries: [
      {
        id: 'job-1',
        shipmentId: '22222222-2222-4222-8222-222222222222',
        status: 'OUT_FOR_DELIVERY',
        attemptsMade: 0,
        lastFailureReason: null,
        createdAt: '2026-10-11T08:00:00.000Z',
        shipment: handoff,
      },
    ],
  };
}

const HANDOFF: ShipmentHandoff = {
  codAmountMinor: 125_050,
  codCurrency: 'BDT',
  recipientPhone: '+8801711223344',
  recipientName: 'Ayesha Rahman',
  recipientAddress: 'House 12, Road 7, Dhanmondi',
};

describe('R6: the delivery job carries what to collect and who to call', () => {
  it('passes the cash amount through to the row', () => {
    const rows = toJobRows(jobsWithHandoff(HANDOFF));

    expect(rows[0]?.shipment?.codAmountMinor).toBe(125_050);
    expect(rows[0]?.shipment?.codCurrency).toBe('BDT');
  });

  it('passes the recipient phone and name through to the row', () => {
    const rows = toJobRows(jobsWithHandoff(HANDOFF));

    expect(rows[0]?.shipment?.recipientPhone).toBe('+8801711223344');
    expect(rows[0]?.shipment?.recipientName).toBe('Ayesha Rahman');
  });

  it('delivers a zero amount for a prepaid parcel, which is what the rider must read', () => {
    // Not null: "prepaid" and "nothing due" are the same instruction, and a nullable amount would
    // make the screen interpret null every render.
    const rows = toJobRows(jobsWithHandoff({ ...HANDOFF, codAmountMinor: 0 }));

    expect(rows[0]?.shipment?.codAmountMinor).toBe(0);
  });

  it('survives a parcel cancelled while the device was offline', () => {
    // A job with no handoff behind it: the row still exists, and the null is the honest answer
    // rather than a default that reads like real data.
    const rows = toJobRows(jobsWithHandoff(null));

    expect(rows[0]?.shipment).toBeNull();
    expect(rows[0]?.title).toContain('Delivery');
  });

  it('never puts a handoff on a pickup', () => {
    // A shop handed the parcel over; there is no customer to call and no cash to take. A pickup row
    // with a phone on it would offer a call to a merchant.
    const jobs: RiderJobs = {
      pickups: [
        {
          id: 'pickup-1',
          shipmentIds: ['shp-1'],
          status: 'ASSIGNED',
          totalWeightGrams: 2000,
          createdAt: '2026-10-11T08:00:00.000Z',
        },
      ],
      deliveries: [],
    };

    expect(toJobRows(jobs)[0]?.shipment).toBeNull();
  });

  it('merges both kinds newest first', () => {
    // A rider reads the top of the list. If the merge ordered by server list rather than by time,
    // yesterday's delivery would sit above a pickup assigned a minute ago.
    const jobs: RiderJobs = {
      pickups: [
        {
          id: 'pickup-1',
          shipmentIds: ['shp-1'],
          status: 'ASSIGNED',
          totalWeightGrams: 2000,
          createdAt: '2026-10-11T09:00:00.000Z',
        },
      ],
      deliveries: [
        {
          id: 'job-1',
          shipmentId: 'shp-2',
          status: 'OUT_FOR_DELIVERY',
          attemptsMade: 0,
          lastFailureReason: null,
          createdAt: '2026-10-11T08:00:00.000Z',
          shipment: HANDOFF,
        },
      ],
    };

    expect(toJobRows(jobs).map((row) => row.kind)).toEqual(['pickup', 'delivery']);
  });

  it('returns nothing at all for a malformed response', () => {
    // A projection is a boundary. An `undefined` batch, or one whose lists are missing, yields no
    // rows rather than a throw — so a server changing shape degrades to an empty feed and never to
    // a rider with a white screen.
    expect(toJobRows(undefined)).toEqual([]);
    expect(toJobRows({} as RiderJobs)).toEqual([]);
  });
});
