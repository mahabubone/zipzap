import { describe, expect, it } from 'vitest';
import { ProjectionQueriesService } from './projection-queries.service.ts';

/**
 * The tenant boundary on the merchant series, minus the database.
 *
 * This is the test that has to exist. `merchantSeries` is the first endpoint that hands a merchant
 * their own money, and the money arrived by re-graining `cod_summary` — so the failure mode is not
 * a crash, it is a 200 that answers for the wrong account. Every projection read here must carry
 * the merchant id as a bound parameter, and that is what these assert: a missing `$1` produces a
 * series spanning every tenant, which looks like success.
 */

interface Query {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function serviceOf(responses: Record<string, unknown[]>) {
  const queries: Query[] = [];
  const fake = {
    transaction: async (fn: (manager: unknown) => Promise<unknown>) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          queries.push({ sql, params });
          const table = sql.includes('cod_summary')
            ? 'cod'
            : sql.includes('merchant_daily_shipments')
              ? 'shipments'
              : 'other';
          return responses[table] ?? [];
        },
      }),
  };
  return { service: new ProjectionQueriesService(fake as never), queries };
}

const SHIPMENT_ROWS = [
  { day: '2026-03-05', created: 4, pickedUp: 3, delivered: 2 },
  { day: '2026-03-06', created: 6, pickedUp: 6, delivered: 1 },
];

describe('ProjectionQueriesService.merchantSeries', () => {
  it('binds the merchant id into BOTH projection reads', async () => {
    const { service, queries } = serviceOf({ shipments: SHIPMENT_ROWS, cod: [] });

    await service.merchantSeries('m-1', '2026-03-01', '2026-03-31');

    const reads = queries.filter(
      (q) => q.sql.includes('merchant_daily_shipments') || q.sql.includes('cod_summary'),
    );
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      // $1 is the merchant. A read that never binds it is a cross-tenant aggregate.
      expect(read.params[0]).toBe('m-1');
      expect(read.sql).toMatch(/merchant_id\s*=\s*\$1/);
    }
  });

  it('never aggregates without the merchant filter', async () => {
    const { service, queries } = serviceOf({ shipments: [], cod: [] });
    await service.merchantSeries('m-1', '2026-03-01', '2026-03-31');

    for (const read of queries) {
      expect(read.sql).not.toMatch(/GROUP BY\s+day\s*$/m);
      expect(read.sql).toContain('merchant_id = $1');
    }
  });

  it('pairs each day with its own money and leaves a day without any at zero', async () => {
    const { service } = serviceOf({
      shipments: SHIPMENT_ROWS,
      cod: [
        {
          day: '2026-03-05',
          currency: 'BDT',
          expectedMinor: '125050',
          collectedMinor: '125000',
          settledMinor: '0',
        },
      ],
    });

    const series = await service.merchantSeries('m-1', '2026-03-01', '2026-03-31');

    expect(series.days).toHaveLength(2);
    expect(series.days[0]).toEqual({
      day: '2026-03-05',
      shipmentsCreated: 4,
      pickedUp: 3,
      delivered: 2,
      currency: 'BDT',
      // Money stays a string across the wire: poisha above 2^53 is not a JSON number.
      expectedMinor: '125050',
      collectedMinor: '125000',
      settledMinor: '0',
    });
    expect(series.days[1]).toMatchObject({ day: '2026-03-06', currency: null, expectedMinor: '0' });
  });

  it('reports the range it was asked for', async () => {
    const { service } = serviceOf({ shipments: [], cod: [] });
    const series = await service.merchantSeries('m-1', '2026-03-01', '2026-03-31');
    expect(series).toEqual({ from: '2026-03-01', to: '2026-03-31', days: [] });
  });
});
