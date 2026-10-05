import { describe, expect, it, vi } from 'vitest';
import { NetworkService, type CoverageCheck } from './network.service.ts';

/**
 * Coverage lookup: rows answer, absence answers too. The rule under test is
 * that no row means NOT serviceable — a default-allow here would turn every
 * unknown zone into a parcel sent nowhere (docs/domains/network.md).
 */

function serviceWith(row: Record<string, unknown> | null): NetworkService {
  return new NetworkService({
    query: vi.fn(async () => (row ? [row] : [])),
  } as never);
}

const COVERED_ROW = {
  zone: 'dhaka-metro',
  serviceable: true,
  estimated_days: 1,
  pickup_available: true,
  delivery_available: true,
  cod_available: true,
};

describe('NetworkService.checkZone', () => {
  it('maps a coverage row to the contract', async () => {
    const check = (await serviceWith(COVERED_ROW).checkZone('dhaka-metro')) as CoverageCheck;
    expect(check).toEqual({
      zone: 'dhaka-metro',
      serviceable: true,
      reason: null,
      estimatedDays: 1,
      pickupAvailable: true,
      deliveryAvailable: true,
      codAvailable: true,
    });
  });

  it('no row = not serviceable, with the zone named in the reason', async () => {
    const check = await serviceWith(null).checkZone('atlantis-01');
    expect(check.serviceable).toBe(false);
    expect(check.reason).toContain('atlantis-01');
    expect(check.estimatedDays).toBeNull();
  });

  it('an explicitly unserviceable row still fails, with its own reason', async () => {
    const check = await serviceWith({
      ...COVERED_ROW,
      zone: 'sylhet-metro',
      serviceable: false,
      cod_available: false,
    }).checkZone('sylhet-metro');
    expect(check.serviceable).toBe(false);
    expect(check.reason).toContain('not serviceable');
    expect(check.codAvailable).toBe(false);
  });

  it('queries its own schema, unqualified names are not used', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => []);
    await new NetworkService({ query } as never).checkZone('x');
    expect(query.mock.calls[0]?.[0]).toMatch(/FROM network\.service_areas/);
  });
});
