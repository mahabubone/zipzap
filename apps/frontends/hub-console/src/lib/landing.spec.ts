import { describe, expect, it } from 'vitest';
import { landing } from './landing.ts';

/**
 * Regression tests for a bug that shipped and could not be seen.
 *
 * The landing page swallowed its own redirect: `redirect()` returns a `Response`, not an `Error`, so
 * the `e instanceof Error` guard written to recognise it never fired, and a signed-in operator bounced
 * between `/` and `/login` forever. No exception was thrown, no console showed anything, and the
 * session looked correct to every tool that reports on it — the login worked, the cookie was set, the
 * app simply would not open.
 *
 * These assertions are about **which way a value travels**. Each one is the shape the bug took.
 */

const signedIn = () => landing({ load: async () => undefined, isRedirect: () => false });
const sessionAbsent = () =>
  landing({
    load: async () => {
      throw new Error('AUTHENTICATION_REQUIRED');
    },
    isRedirect: () => false,
  });

describe('landing', () => {
  it('sends a signed-in principal to the hub they are assigned to', async () => {
    await expect(signedIn()).resolves.toEqual({ to: '/my-hub' });
  });

  it('sends an absent session to the login page', async () => {
    await expect(sessionAbsent()).resolves.toEqual({ to: '/login' });
  });

  it('passes a redirect through untouched', async () => {
    // The bug. The loader threw a redirect — TanStack's `redirect()` returns a `Response` — and the
    // old code caught it, failed to recognise it, and replaced it with `{ to: '/login' }`. So an
    // operator mid-flow was sent to sign in again while holding a valid session.
    const thrown = { isRedirect: true, response: new Response(null, { status: 302 }) };
    const attempt = landing({
      load: async () => {
        throw thrown;
      },
      isRedirect: (error) => Boolean((error as { isRedirect?: unknown })?.isRedirect),
    });

    // Rejects with that exact value — not with a landing decision derived from it.
    await expect(attempt).rejects.toBe(thrown);
  });

  it('treats an error that merely looks like a redirect as an absent session', async () => {
    // The mirror, because the recogniser is the whole mechanism: a value carrying an `isRedirect`
    // property but not recognised by the router's own check must not be trusted. Trusting the shape
    // instead of the check is how the original guard was written.
    const impostor = new Error('boom') as Error & { isRedirect: boolean };
    impostor.isRedirect = true;

    const attempt = landing({
      load: async () => {
        throw impostor;
      },
      isRedirect: () => false,
    });

    await expect(attempt).resolves.toEqual({ to: '/login' });
  });

  it('rejects nothing on the happy path', async () => {
    // A guard that throws on success is a harder bug to spot than one that fails open: it works in
    // development and breaks in production, or the other way round, depending on the router version.
    await expect(signedIn()).resolves.toBeDefined();
  });
});
