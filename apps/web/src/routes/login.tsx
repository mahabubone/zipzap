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
      void navigate({ to: '/app' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <FormField label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
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
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner /> : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
