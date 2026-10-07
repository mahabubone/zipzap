import { describe, expect, it, vi } from 'vitest';
import { ReportService } from './report.service.ts';
import type { DashboardService, LiveCounts } from './dashboard.service.ts';
import type { UtilisationService } from '../rider/utilisation.service.ts';
import type { ProjectionQueriesService } from '../analytics/projection-queries.service.ts';

const kpis = {
  shipments: { created: 10, pickedUp: 8, delivered: 5 },
  deliverySuccess: { delivered: 5, failed: 1, rate: 5 / 6 },
  returns: { delivered: 5, returned: 1, rate: 1 / 5 },
  cod: [
    {
      currency: 'BDT',
      expectedMinor: 100,
      collectedMinor: 90,
      settledMinor: 80,
      collectionRate: 0.9,
    },
  ],
  riderWork: { delivered: 5, attempts: 7, failed: 1 },
  hubVolume: [{ hubCode: 'DAC-1', scans: 42 }],
} as unknown as Awaited<ReturnType<ProjectionQueriesService['kpis']>>;

const counts = {
  timestamp: '2026-10-07T00:00:00.000Z',
  shipments: { lostOrDamaged: 1, exception: 2 },
  hub: { backlog: 3, networkHubs: 6 },
  riders: { total: 12, online: 9, available: 4 },
} as unknown as LiveCounts;

const pool = { totalCapacity: 12, inUseCapacity: 5, loadFactor: 0.42 };

function make(overrides: { from?: string; to?: string } = {}) {
  const dashboard = { getLiveCounts: vi.fn(async () => counts) } as unknown as DashboardService;
  const utilisation = { getPoolLoad: vi.fn(async () => pool) } as unknown as UtilisationService;
  const projections = { kpis: vi.fn(async () => kpis) } as unknown as ProjectionQueriesService;
  const service = new ReportService(dashboard, utilisation, projections);
  return { service, dashboard, utilisation, projections, overrides };
}

describe('report service', () => {
  it('defaults to the last 30 days ending today', async () => {
    const { service, projections } = make();
    const report = await service.getReport();

    expect(report.range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const days = (Date.parse(report.range.to) - Date.parse(report.range.from)) / 86_400_000;
    expect(days).toBe(30);
    expect(projections.kpis).toHaveBeenCalledWith(report.range.from, report.range.to);
  });

  it('passes an explicit range through and joins the three views', async () => {
    const { service, dashboard, utilisation, projections } = make();

    const report = await service.getReport('2026-10-01', '2026-10-07');

    expect(report.range).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(projections.kpis).toHaveBeenCalledWith('2026-10-01', '2026-10-07');
    expect(report.shipments).toEqual(kpis.shipments);
    expect(report.cod).toEqual(kpis.cod);
    expect(dashboard.getLiveCounts).toHaveBeenCalledOnce();
    expect(utilisation.getPoolLoad).toHaveBeenCalledOnce();
    expect(report.live).toEqual({
      timestamp: counts.timestamp,
      hub: { backlog: 3, networkHubs: 6 },
      exceptions: { lostOrDamaged: 1, exception: 2 },
      riders: { total: 12, online: 9, available: 4 },
      poolUtilisation: pool,
    });
  });

  it('keeps null rates for an empty window instead of reporting 0%', async () => {
    const { service, projections } = make();
    vi.mocked(projections.kpis).mockResolvedValueOnce({
      ...kpis,
      deliverySuccess: { delivered: 0, failed: 0, rate: null },
    } as typeof kpis);

    const report = await service.getReport('2026-10-07', '2026-10-07');

    expect(report.deliverySuccess.rate).toBeNull();
  });
});
