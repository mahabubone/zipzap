import { useState, type FormEvent } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, FormField, Input, Spinner } from '@zipzap/ui';
import { anonClient } from '../lib/api.ts';
import { writeSession } from '../lib/session.ts';

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
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Control tower</h1>
        <p className="mt-2 text-sm text-slate-600">Operations staff. Your network, live.</p>
        <form className="mt-8 flex flex-col gap-5" onSubmit={submit}>
          <FormField label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              className="h-12"
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
              className="h-12"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          <Button type="submit" disabled={pending} className="h-12">
            {pending ? <Spinner /> : 'Sign in'}
          </Button>
        </form>
      </div>
    </main>
  );
}
