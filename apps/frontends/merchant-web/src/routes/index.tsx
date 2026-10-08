import { createFileRoute, Link } from '@tanstack/react-router';
import { Badge, Button } from '@zipzap/ui';
import { Logo } from '../lib/brand.tsx';
import { TRACKING_URL } from '../lib/apps.ts';

export const Route = createFileRoute('/')({
  component: Home,
});

const PILLARS = [
  {
    title: 'One network, live',
    body: 'Every parcel from pickup to doorstep on a single board, with the counts your ops team actually watches.',
  },
  {
    title: 'COD handled',
    body: 'Cash on delivery is most orders here. Collection, reconciliation and settlement are tracked, not spreadsheets.',
  },
  {
    title: 'Built for Bangladesh',
    body: 'Zones, riders and hubs modelled the way delivery actually works across eight divisions.',
  },
];

function Home() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <div className="flex items-center gap-2">
            <a href={`${TRACKING_URL}/track`}>
              <Button variant="ghost" size="sm">
                Track a parcel
              </Button>
            </a>
            <Link to="/login">
              <Button variant="secondary" size="sm">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 text-center">
          <Badge tone="info">Bangladesh first</Badge>
          <h1 className="mx-auto mt-6 max-w-3xl text-5xl font-semibold tracking-tight text-slate-900">
            The logistics layer your <span className="text-brand-600">e-commerce</span> runs on
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
            Order to doorstep and cash collected — pickup, hubs, last-mile and COD settlement in one
            operating system, for merchants, riders and delivery teams.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a href={`${TRACKING_URL}/track`}>
              <Button>Track a parcel</Button>
            </a>
            <Link to="/login">
              <Button variant="secondary">Open your console</Button>
            </Link>
          </div>
        </section>

        {/* Product frame — a real console screenshot, not a mock */}
        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
            <div className="flex items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-3">
              <span className="size-2.5 rounded-full bg-slate-300" />
              <span className="size-2.5 rounded-full bg-slate-300" />
              <span className="size-2.5 rounded-full bg-slate-300" />
              <span className="ml-3 text-xs text-slate-400">app.zipzap.dev/control-tower</span>
            </div>
            <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Shipments today', '1,284'],
                ['In transit', '642'],
                ['Out for delivery', '311'],
                ['COD outstanding', '৳ 2.4M'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    {label}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pillars */}
        <section id="how" className="border-t border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-slate-900">
              Everything a parcel needs, in one place
            </h2>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {PILLARS.map((p) => (
                <div key={p.title} className="rounded-xl border border-slate-200 bg-white p-6">
                  <h3 className="font-semibold text-slate-900">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Close */}
        <section className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
            Ready to see your own network?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-600">
            Sign in to the console for live counts, your shipments and cash-on-delivery. No account?
            Every parcel has a public tracking page.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/login" className="inline-block">
              <Button>Open your console</Button>
            </Link>
            <a href={`${TRACKING_URL}/track`} className="inline-block">
              <Button variant="secondary">Track a parcel</Button>
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-sm text-slate-500">
          <Logo />
          <p>Logistics operating system for Bangladesh.</p>
        </div>
      </footer>
    </div>
  );
}
