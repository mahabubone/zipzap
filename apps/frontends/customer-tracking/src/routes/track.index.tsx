import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { BrandMark, Button, Input } from '@zipzap/ui';
import { useState, type SubmitEvent } from 'react';
import { MERCHANT_WEB_URL } from '../lib/apps.ts';

export const Route = createFileRoute('/track/')({
  component: TrackLookup,
});

/** Public — no account, no session. A recipient has a code, not a login. */
function TrackLookup() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed) void navigate({ to: '/track/$trackingCode', params: { trackingCode: trimmed } });
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <BrandMark />
          <a
            href={`${MERCHANT_WEB_URL}/login`}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Merchant sign in
          </a>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-md text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Track your parcel
          </h1>
          <p className="mt-3 text-slate-600">
            Enter the tracking code from your confirmation message or delivery notice.
          </p>

          <form onSubmit={submit} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Input
              name="trackingCode"
              aria-label="Tracking code"
              placeholder="ZP-XXXXXXXXXX"
              autoComplete="off"
              autoCapitalize="characters"
              className="text-center sm:text-left"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button type="submit" disabled={code.trim() === ''} className="shrink-0">
              Track
            </Button>
          </form>

          <p className="mt-6 text-xs text-slate-400">
            No account needed. Tracking shows where your parcel is, nothing else.
          </p>
        </div>
      </main>
    </div>
  );
}
