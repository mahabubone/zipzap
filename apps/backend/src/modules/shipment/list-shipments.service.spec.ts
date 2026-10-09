import { describe, expect, it, vi } from 'vitest';
import { ListShipmentsService } from './list-shipments.service.ts';
import { ValidationFailedError } from '../../common/domain-error.ts';

/**
 * Two properties, and both are silent failures if they break:
 *
 *  1. Filters reach the REPOSITORY. Paging first and filtering afterwards would
 *     return a short page — the merchant asks for 25 delivered parcels and gets
 *     however many survived the slice, with a "next page" that skips the rest.
 *  2. A bad filter is a 400 naming the field. Falling back to "no filter" would
 *     show the merchant their entire account looking like a filter that worked.
 *
 * What the repository then does with those filters is SQL, and SQL is proved
 * against a real Postgres rather than a mock.
 */
function harness(rows: Array<Record<string, unknown>> = []) {
  const pageByMerchant = vi.fn().mockResolvedValue(rows);
  const service = new ListShipmentsService({ manager: {} } as never, { pageByMerchant } as never);
  return { service, pageByMerchant };
}

const ROW = {
  id: 'ship-1',
  trackingCode: 'ZP-8F32A1',
  status: 'DELIVERED',
  merchantReference: null,
  codAmountMinor: 125050,
  codCurrency: 'BDT',
  createdAt: new Date('2026-10-08T00:00:00Z'),
};

describe('ListShipmentsService', () => {
  it('passes no filters through when the query is empty', async () => {
    const { service, pageByMerchant } = harness();

    await service.execute('m-1', '25', undefined);

    expect(pageByMerchant.mock.calls[0]?.[4]).toEqual({
      statuses: null,
      zone: null,
      search: null,
      from: null,
      to: null,
    });
  });

  it('parses a status group into the statuses it names', async () => {
    const { service, pageByMerchant } = harness();

    await service.execute('m-1', '25', undefined, { status: 'LOST,DAMAGED' });

    expect(pageByMerchant.mock.calls[0]?.[4]?.statuses).toEqual(['LOST', 'DAMAGED']);
  });

  it('trims the search term before it reaches SQL', async () => {
    const { service, pageByMerchant } = harness();

    await service.execute('m-1', '25', undefined, { q: '  ZP-8F3  ' });

    expect(pageByMerchant.mock.calls[0]?.[4]?.search).toBe('ZP-8F3');
  });

  it('scopes the read to the caller, never to a query param', async () => {
    const { service, pageByMerchant } = harness();

    await service.execute('m-1', '25', undefined, { zone: 'dhaka-metro' });

    expect(pageByMerchant.mock.calls[0]?.[1]).toBe('m-1');
  });

  it('rejects an unknown status instead of filtering by nothing', async () => {
    const { service, pageByMerchant } = harness();

    await expect(
      service.execute('m-1', '25', undefined, { status: 'DELIVERD' }),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    expect(pageByMerchant).not.toHaveBeenCalled();
  });

  it('reports every bad field at once, so a caller fixes one round trip', async () => {
    const { service } = harness();

    const error = (await service
      .execute('m-1', '25', undefined, { status: 'NOPE', from: 'yesterday' })
      .then(
        () => null,
        (e: unknown) => e,
      )) as ValidationFailedError;

    expect(error.issues.map((i: { path: string }) => i.path)).toEqual(['status', 'from']);
  });

  it('still refuses a malformed cursor before it looks at the filters', async () => {
    const { service, pageByMerchant } = harness();

    await expect(service.execute('m-1', '25', 'not-a-cursor', { q: 'x' })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    expect(pageByMerchant).not.toHaveBeenCalled();
  });

  it('returns one extra row of lookahead and reports hasMore from it', async () => {
    const { service, pageByMerchant } = harness([ROW, { ...ROW, id: 'ship-2' }]);

    const page = await service.execute('m-1', '1', undefined);

    // The repository is asked for limit+1; the extra row is the lookahead and
    // must not be handed to the merchant.
    expect(pageByMerchant.mock.calls[0]?.[3]).toBe(2);
    expect(page.data.map((r) => r.id)).toEqual(['ship-1']);
    expect(page.pagination.hasMore).toBe(true);
  });

  it('reports no cursor when the page came back short', async () => {
    const { service } = harness([ROW]);

    const page = await service.execute('m-1', '25', undefined);

    expect(page.pagination.hasMore).toBe(false);
    expect(page.pagination.nextCursor).toBeNull();
  });
});
