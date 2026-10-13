import { createFileRoute } from '@tanstack/react-router';
import { PageHeader, ErrorState, Skeleton } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '@zipzap/web-kit';
import { formatWhen } from '@zipzap/web-kit';

export const Route = createFileRoute('/app/analytics')({
  component: AnalyticsScreen,
});

interface MerchantAnalyticsDay {
  readonly day: string;
  readonly shipmentsCreated: number;
  readonly pickedUp: number;
  readonly delivered: number;
  readonly currency: string | null;
  readonly expectedMinor: string;
  readonly collectedMinor: string;
  readonly settledMinor: string;
}

interface MerchantAnalyticsSeries {
  readonly from: string;
  readonly to: string;
  readonly days: readonly MerchantAnalyticsDay[];
}

/**
 * The analytics screen: your parcels and money over time.
 *
 * Two series on one chart — parcels on the left axis, money on the right — because
 * that is the question a merchant asks: "how many parcels did I send, and how much
 * money came back?" The control tower sees network totals; this is the same shape
 * scoped to one account.
 *
 * Deliberately not here: delivery success rate and return rate. Those projections
 * are network-wide (migration `0047`) because their failure counts come from
 * `DeliveryAttempted`, which carries no `merchantId`. A chart that drew them per
 * merchant would be drawing a number this data cannot support.
 */
function AnalyticsScreen() {
  const series = useAsync(() => apiClient().merchantAnalytics());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Your daily parcel counts and COD collections, one point per day."
        actions={
          <button
            type="button"
            onClick={series.reload}
            className="text-sm text-slate-500 hover:text-slate-800"
          >
            Refresh
          </button>
        }
      />

      {series.error ? (
        <ErrorState message={series.error} retry={series.reload} />
      ) : !series.data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="flex flex-col gap-6">
          <AnalyticsChart series={series.data} />
          <AnalyticsTable series={series.data} />
        </div>
      )}
    </div>
  );
}

function AnalyticsChart({ series }: { series: MerchantAnalyticsSeries }) {
  const days = series.days;
  if (days.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500">
        No data for the selected window. Try a wider range.
      </section>
    );
  }

  // Simple inline SVG chart — no external dependency. The product's first chart
  // is honest about what the data supports: parcels (left) + money (right).
  // `ponytail:` if a chart library is ever needed, swap this for recharts — the
  // data contract stays the same because the API returns typed arrays, not pixels.

  const parcelMax = Math.max(...days.map((d) => d.shipmentsCreated), 1);
  const moneyMax = Math.max(...days.map((d) => Number(d.expectedMinor)), 1);

  const width = 600; // responsive parent will scale via viewBox
  const height = 240;
  const margin = { top: 20, right: 60, bottom: 40, left: 60 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xStep = innerWidth / Math.max(days.length - 1, 1);

  const parcelY = (value: number) => margin.top + innerHeight - (value / parcelMax) * innerHeight;
  const moneyY = (value: number) => margin.top + innerHeight - (value / moneyMax) * innerHeight;

  const parcelPath = days
    .map((d, i) => {
      const x = margin.left + i * xStep;
      const y = parcelY(d.shipmentsCreated);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const pickedPath = days
    .map((d, i) => {
      const x = margin.left + i * xStep;
      const y = parcelY(d.pickedUp);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const deliveredPath = days
    .map((d, i) => {
      const x = margin.left + i * xStep;
      const y = parcelY(d.delivered);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const expectedPath = days
    .map((d, i) => {
      const x = margin.left + i * xStep;
      const y = moneyY(Number(d.expectedMinor));
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const collectedPath = days
    .map((d, i) => {
      const x = margin.left + i * xStep;
      const y = moneyY(Number(d.collectedMinor));
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const settledPath = days
    .map((d, i) => {
      const x = margin.left + i * xStep;
      const y = moneyY(Number(d.settledMinor));
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    })
    .join(' ');

  const xTicks =
    days.length <= 14 ? days : days.filter((_, i) => i % Math.ceil(days.length / 14) === 0);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="relative h-64 w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full"
          role="img"
          aria-label="Daily parcels and COD money"
        >
          {/* Y grid */}
          <g stroke="#e2e8f0" stroke-width="0.5">
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
              <line
                key={frac}
                x1={margin.left}
                y1={margin.top + innerHeight * (1 - frac)}
                x2={width - margin.right}
                y2={margin.top + innerHeight * (1 - frac)}
              />
            ))}
          </g>

          {/* X grid */}
          <g stroke="#e2e8f0" stroke-width="0.5">
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
              <line
                key={frac}
                x1={margin.left + innerWidth * frac}
                y1={margin.top}
                x2={margin.left + innerWidth * frac}
                y2={height - margin.bottom}
              />
            ))}
          </g>

          {/* Y labels - parcels (left) */}
          <g font-size="11" fill="#64748b" text-anchor="end">
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
              <text
                key={`parcel-${frac}`}
                x={margin.left - 8}
                y={margin.top + innerHeight * (1 - frac) + 4}
                dominant-baseline="middle"
              >
                {Math.round(parcelMax * frac)}
              </text>
            ))}
          </g>

          {/* Y labels - money (right) */}
          <g font-size="11" fill="#64748b" text-anchor="start">
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
              <text
                key={`money-${frac}`}
                x={width - margin.right + 8}
                y={margin.top + innerHeight * (1 - frac) + 4}
                dominant-baseline="middle"
              >
                {formatMoneyMinor(Math.round(moneyMax * frac))}
              </text>
            ))}
          </g>

          {/* X labels */}
          <g font-size="11" fill="#64748b" text-anchor="middle" dominant-baseline="hanging">
            {xTicks.map((d) => {
              const x = margin.left + days.indexOf(d) * xStep;
              return (
                <text key={d.day} x={x} y={height - margin.bottom + 8}>
                  {formatDayLabel(d.day)}
                </text>
              );
            })}
          </g>

          {/* Axis lines */}
          <g stroke="#94a3b8" stroke-width="1">
            <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} />
            <line
              x1={width - margin.right}
              y1={margin.top}
              x2={width - margin.right}
              y2={height - margin.bottom}
            />
            <line
              x1={margin.left}
              y1={height - margin.bottom}
              x2={width - margin.right}
              y2={height - margin.bottom}
            />
          </g>

          {/* Expected path (dashed) */}
          <path
            d={expectedPath}
            fill="none"
            stroke="#94a3b8"
            stroke-width="2"
            stroke-dasharray="4 4"
            opacity={0.6}
          />

          {/* Collected path */}
          <path d={collectedPath} fill="none" stroke="#22c55e" stroke-width="2" />

          {/* Settled path */}
          <path
            d={settledPath}
            fill="none"
            stroke="#16a34a"
            stroke-width="2"
            stroke-dasharray="6 3"
            opacity={0.8}
          />

          {/* Parcel paths */}
          <path d={parcelPath} fill="none" stroke="#3b82f6" stroke-width="2" />
          <path
            d={pickedPath}
            fill="none"
            stroke="#60a5fa"
            stroke-width="1.5"
            stroke-dasharray="3 3"
            opacity={0.8}
          />
          <path
            d={deliveredPath}
            fill="none"
            stroke="#93c5fd"
            stroke-width="1.5"
            stroke-dasharray="2 2"
            opacity={0.8}
          />

          {/* Data points - collected */}
          {days.map((d, i) => (
            <circle
              key={`collected-${d.day}`}
              cx={margin.left + i * xStep}
              cy={moneyY(Number(d.collectedMinor))}
              r={3}
              fill="#22c55e"
              stroke="white"
              stroke-width={1.5}
            />
          ))}

          {/* Data points - delivered */}
          {days.map((d, i) => (
            <circle
              key={`delivered-${d.day}`}
              cx={margin.left + i * xStep}
              cy={parcelY(d.delivered)}
              r={3}
              fill="#3b82f6"
              stroke="white"
              stroke-width={1.5}
            />
          ))}
        </svg>

        {/* Legend */}
        <div className="absolute top-2 right-2 flex flex-col gap-1.5 px-2 py-1.5 bg-white/90 backdrop-blur-sm rounded border border-slate-200 text-xs">
          <LegendItem color="#3b82f6" label="Created" />
          <LegendItem color="#60a5fa" label="Picked up" dash="3 3" />
          <LegendItem color="#93c5fd" label="Delivered" dash="2 2" />
          <LegendItem color="#94a3b8" label="COD Expected" dash="4 4" opacity={0.6} />
          <LegendItem color="#22c55e" label="COD Collected" />
          <LegendItem color="#16a34a" label="COD Settled" dash="6 3" />
        </div>
      </div>
    </section>
  );
}

function LegendItem({
  color,
  label,
  dash,
  opacity = 1,
}: {
  color: string;
  label: string;
  dash?: string;
  opacity?: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <svg width="24" height="8" style={{ opacity }}>
        <line x1="0" y1="4" x2="24" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dash} />
      </svg>
      <span className="text-slate-700">{label}</span>
    </div>
  );
}

function formatMoneyMinor(minor: number): string {
  if (minor >= 1_000_000_000) return `${(minor / 1_000_000_000).toFixed(1)}B`;
  if (minor >= 1_000_000) return `${(minor / 1_000_000).toFixed(1)}M`;
  if (minor >= 1_000) return `${(minor / 1_000).toFixed(1)}K`;
  return String(minor);
}

function formatDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function AnalyticsTable({ series }: { series: MerchantAnalyticsSeries }) {
  const days = series.days;
  if (days.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <caption className="px-4 py-3 text-left text-sm font-medium text-slate-900">
          Daily breakdown
        </caption>
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-4 py-2 text-left font-medium">
              Day
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Created
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Picked up
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Delivered
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              COD Expected
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              COD Collected
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              COD Settled
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row" className="px-4 py-2 text-left font-normal text-slate-700">
                {formatWhen(`${d.day}T00:00:00Z`)}
              </th>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900">
                {d.shipmentsCreated}
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900">
                {d.pickedUp}
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900">
                {d.delivered}
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900">
                {formatMoneyMinor(Number(d.expectedMinor))}
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900 text-green-700">
                {formatMoneyMinor(Number(d.collectedMinor))}
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900 text-emerald-700">
                {formatMoneyMinor(Number(d.settledMinor))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
