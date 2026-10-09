import { useState, type FormEvent } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, FormField, Input, Spinner } from '@zipzap/ui';
import { anonClient } from '../lib/api.ts';
import { writeSession } from '../lib/session.ts';
import { Logo } from '../lib/brand.tsx';

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
      const session = await anonClient().login(email.trim(), password);
      writeSession({ token: session.token, expiresAt: session.expiresAt });
      void navigate({ to: '/' });
    } catch (e) {
      // A hub operator signs in on a shared depot tablet, once a shift. There is no "forgot
      // password" here and no reason to pretend — the error is whatever the server said, because
      // a wrong role looks exactly like a wrong password and guessing locally helps nobody.
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        <Logo className="size-11" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Hub console</h1>
        <p className="mt-2 text-slate-600">
          For hub staff. Sign in with the account your depot issued you.
        </p>

        <form className="mt-8 flex flex-col gap-5" onSubmit={submit}>
          <FormField label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              // 16px: iOS zooms the viewport on focus for anything smaller, which on a phone
              // held in a gloved hand means the form moves under the thumb mid-tap.
              className="h-12 text-base"
              placeholder="you@hub.com"
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
              className="h-12 text-base"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          <Button type="submit" disabled={pending} className="h-14 w-full text-base">
            {pending ? <Spinner /> : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
