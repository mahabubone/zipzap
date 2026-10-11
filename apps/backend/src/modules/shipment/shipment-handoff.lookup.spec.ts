/**
 * The handoff seam the rider module reads parcels through.
 *
 * These exist because the delivery job used to carry only a shipment id, so a rider was asked for
 * cash without being told how much and to call somebody whose number had never reached the device.
 * Both fields live on the shipment, in a schema `delivery` may not read — so the seam is the answer,
 * and the bug was real enough to ship a feature for it.
 *
 * The tests live here, beside the entity, for the same reason the seam does: `shipment-handoff.lookup.ts`
 * imports `ShipmentEntity`, and a spec that imported it from the rider module would trip the ADR-0002
 * boundary checker.
 */

import { describe, expect, it } from 'vitest';
import type { ShipmentEntity } from './shipment.entity.ts';
import { ShipmentHandoffLookup, type ShipmentHandoff } from './shipment-handoff.lookup.ts';

function shipment(id: string, overrides: Partial<ShipmentEntity> = {}): ShipmentEntity {
  return {
    id,
    codAmountMinor: 125_050,
    codCurrency: 'BDT',
    recipientName: 'Ayesha Rahman',
    recipientAddress: 'House 12, Road 7, Dhanmondi',
    recipientPhone: '+8801711223344',
    ...overrides,
  } as ShipmentEntity;
}

/** A DataSource stub that hands back `rows`, capturing the ids it was asked for. */
function lookupReturning(rows: readonly ShipmentEntity[]): {
  lookup: ShipmentHandoffLookup;
  seen: string[][];
} {
  const seen: string[][] = [];
  const transaction = async <T>(body: (manager: unknown) => Promise<T>): Promise<T> => {
    const manager = {
      createQueryBuilder: () => ({
        where: (_entity: unknown, params: { ids: string[] }) => {
          seen.push([...(params.ids ?? [])]);
          return { getMany: async () => rows };
        },
      }),
    };
    return body(manager);
  };
  return { lookup: new ShipmentHandoffLookup({ transaction } as never), seen };
}

describe('ShipmentHandoffLookup', () => {
  it('returns a handoff keyed by shipment id', async () => {
    const { lookup } = lookupReturning([shipment('shp-1')]);

    const handoffs = await lookup.forShipments(['shp-1']);

    expect([...handoffs.keys()]).toEqual(['shp-1']);
    expect(handoffs.get('shp-1')?.codAmountMinor).toBe(125_050);
    expect(handoffs.get('shp-1')?.recipientPhone).toBe('+8801711223344');
  });

  it('omits shipments that do not exist rather than inventing one', async () => {
    // A parcel cancelled while the rider was offline still has a job on the van. The honest
    // answer is no handoff, not a default that reads like real data.
    const { lookup } = lookupReturning([shipment('shp-1')]);

    const handoffs = await lookup.forShipments(['shp-1', 'shp-gone']);

    expect([...handoffs.keys()]).toEqual(['shp-1']);
  });

  it('de-duplicates ids so a repeated list is not a repeated query', async () => {
    const { lookup, seen } = lookupReturning([shipment('shp-1'), shipment('shp-2')]);

    await lookup.forShipments(['shp-1', 'shp-2', 'shp-1']);

    expect(seen[0]).toEqual(['shp-1', 'shp-2']);
  });

  it('returns nothing at all for an empty id list, without a query', async () => {
    let queried = false;
    const lookup = new ShipmentHandoffLookup({
      transaction: async <T>(body: (manager: unknown) => Promise<T>): Promise<T> => {
        queried = true;
        return body({} as never);
      },
    } as never);

    const handoffs = await lookup.forShipments([]);

    expect(handoffs.size).toBe(0);
    expect(queried).toBe(false);
  });

  it('drops empty ids rather than sending them to Postgres', async () => {
    const { lookup, seen } = lookupReturning([shipment('shp-1'), shipment('shp-2')]);

    await lookup.forShipments(['shp-1', '', 'shp-2']);

    expect(seen[0]).toEqual(['shp-1', 'shp-2']);
  });

  it('reads the amount as a number, since the column is bigint and JSON must not carry a string', async () => {
    const { lookup } = lookupReturning([shipment('shp-1')]);
    const handoffs = await lookup.forShipments(['shp-1']);
    // A bigint crossing as a string would make the rider's addition silently wrong.
    expect(typeof handoffs.get('shp-1')?.codAmountMinor).toBe('number');
  });

  it('carries the recipient even when only the name is known', async () => {
    const { lookup } = lookupReturning([shipment('shp-1', { recipientPhone: undefined })]);
    const handoff: ShipmentHandoff | undefined = await lookup
      .forShipments(['shp-1'])
      .then((m) => m.get('shp-1'));
    expect(handoff?.recipientPhone).toBeUndefined();
    expect(handoff?.recipientName).toBe('Ayesha Rahman');
  });

  it('chunks a long id list rather than building one unbounded IN clause', async () => {
    const seen: string[][] = [];
    const lookup = new ShipmentHandoffLookup({
      transaction: async <T>(body: (manager: unknown) => Promise<T>): Promise<T> => {
        const manager = {
          createQueryBuilder: () => ({
            where: (_entity: unknown, params: { ids: string[] }) => {
              seen.push([...(params.ids ?? [])]);
              return { getMany: async () => [] as ShipmentEntity[] };
            },
          }),
        };
        return body(manager);
      },
    } as never);

    // More ids than one chunk carries: the caller asked for a page size somebody else raised.
    await lookup.forShipments(Array.from({ length: 250 }, (_, i) => `shp-${i}`));

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.reduce((total, ids) => total + ids.length, 0)).toBe(250);
  });
});
