import { createFileRoute } from '@tanstack/react-router';
import { ErrorState, PageHeader, Skeleton } from '@zipzap/ui';
import { apiClient } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { formatMinor } from '../../lib/format.ts';
import { bps } from '../../lib/money.ts';

export const Route = createFileRoute('/app/pricing')({
  component: RateCardScreen,
});

/**
 * The rate card — the plan's answer to RedX and Steadfast publishing one and CarryBee pretending
 * it does not exist.
 *
 * The worked examples are the point, and they are not decoration. A table of coefficients is a rule,
 * not a price: "৳20 per kg, ৳180 per thousand on cash, plus 5% tax" is unreadable without doing
 * arithmetic in your head while holding a parcel. "৳95 for a 1 kg parcel inside Dhaka" is a price,
 * and it is the number a merchant actually compares against a competitor.
 *
 * Those examples come from the server, computed by calling the same `quote()` a real quote calls —
 * so a card cannot quote ৳95 and charge ৳96.
 */
function RateCardScreen() {
  const card = useAsync(() => apiClient().rateCard());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Rate card"
        description="What we charge, in public, for the plan you are on."
      />

      {card.error ? (
        <ErrorState message={card.error} retry={card.reload} />
      ) : !card.data ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-lg border border-slate-200 bg-white">
              <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-900">
                Worked examples
              </h2>
              <ul className="divide-y divide-slate-100">
                {card.data.examples.map((example) => (
                  <li
                    key={example.label}
                    className="flex items-baseline justify-between gap-4 px-5 py-3"
                  >
                    <span className="text-sm text-slate-700">{example.label}</span>
                    <span className="font-mono tabular-nums text-slate-900">
                      {formatMinor(example.totalMinor, card.data!.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white">
              <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-medium text-slate-900">
                How that is calculated
              </h2>
              <dl className="divide-y divide-slate-100 text-sm">
                <Row
                  label="Base delivery fee"
                  value={formatMinor(card.data.baseFeeMinor, card.data.currency)}
                />
                <Row
                  label="Each additional kilogram"
                  value={formatMinor(card.data.perKgMinor, card.data.currency)}
                />
                <Row label="Fee on cash collected" value={bps(card.data.codFeeBps)} />
                <Row
                  label="Outside the main city"
                  value={formatMinor(card.data.remoteAreaFeeMinor, card.data.currency)}
                />
                <Row
                  label="Fragile handling"
                  value={formatMinor(card.data.fragileFeeMinor, card.data.currency)}
                />
                <Row label="Tax" value={bps(card.data.taxBps)} />
                <Row
                  label={`Your plan (${card.data.plan})`}
                  // Stated as "no discount" rather than 0%: a merchant should never have to ask
                  // whether a missing number means zero or means we did not tell them.
                  value={
                    card.data.planDiscountBps > 0
                      ? `${bps(card.data.planDiscountBps)} off`
                      : 'No discount on this plan'
                  }
                />
              </dl>
            </section>
          </div>

          <p className="text-xs text-slate-500">
            Rates are version {card.data.version}. A price change is a new version — a parcel always
            keeps the rate it was quoted, so a later change cannot alter what you were charged.
          </p>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-mono tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
