import { useState, type FormEvent } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Button, FormField, Input, Spinner } from '@zipzap/ui';
import { Logo } from '../lib/brand.tsx';
import { anonClient } from '../lib/api.ts';

export const Route = createFileRoute('/login')({
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      // No token is stored here. The server sets the session as an `HttpOnly` cookie, which
      // script cannot read and the browser attaches on its own — so there is nothing for this
      // route to keep, and nothing for an XSS to steal. Writing it to `sessionStorage` was the
      // old model and is exactly the exposure this removes.
      await anonClient().login(email.trim(), password);
      void navigate({ to: '/app' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — the pitch, hidden on small screens where it would just
          push the form below the fold. */}
      <aside className="hidden flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <Logo className="size-9" />
        <div className="max-w-md">
          <p className="text-3xl font-semibold tracking-tight">
            Every parcel, every rider, every taka.
          </p>
          <p className="mt-4 leading-relaxed text-slate-400">
            One console for live network counts, your shipments and cash-on-delivery — modelled the
            way delivery actually works across Bangladesh.
          </p>
        </div>
        <p className="text-sm text-slate-500">Bangladesh first.</p>
      </aside>

      <main className="flex flex-col justify-center px-6 py-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="lg:hidden">
            <Logo className="size-9" />
          </div>

          <h1 className="mt-8 text-2xl font-semibold tracking-tight text-slate-900 lg:mt-0">
            Sign in
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Use the email your merchant account is registered under.
          </p>

          <form className="mt-8 flex flex-col gap-4" onSubmit={submit}>
            <FormField label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@merchant.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>
            <FormField label="Password" htmlFor="password" error={error ?? undefined}>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                invalid={error !== null}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>
            <Button type="submit" disabled={pending} className="mt-2 w-full">
              {pending ? <Spinner /> : 'Sign in'}
            </Button>
          </form>

          <p className="mt-8 text-sm text-slate-500">
            <Link to="/" className="hover:text-slate-800 hover:underline">
              Back to home
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
