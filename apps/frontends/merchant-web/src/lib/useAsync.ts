import { useCallback, useEffect, useRef, useState } from 'react';
import { ZipZapApiError } from '@zipzap/api-client';

export interface Async<T> {
  readonly data: T | undefined;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
}

/**
 * Fetch-on-mount for a screen. One shape for data/error/loading so no screen
 * hand-rolls the same three useStates.
 *
 * `key` re-runs the fetch when it changes. A screen whose query lives in state
 * (a cursor, a filter) passes it here instead of calling `reload()` from an
 * effect — that would fetch once with the old value and once with the new.
 *
 *  ponytail: no cache and no request dedupe — every mount refetches. Add
 *  @tanstack/react-query when a second screen needs the same list, or when a
 *  mutation must invalidate something this fetched. */
export function useAsync<T>(load: () => Promise<T>, key = ''): Async<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // Held in a ref so a caller passing an inline closure does not re-fetch on
  // every render — the effect keys off `nonce` alone.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    loadRef
      .current()
      .then((d) => {
        if (!live) return;
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError(messageFor(e));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [nonce, key]);

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

/**
 * The sentence a person reads when a load fails.
 *
 * It used to be `${code}: ${detail}`, which rendered as
 * `AUTHENTICATION_REQUIRED: AuthenticationRequiredError` — a machine code and a TypeScript class
 * name, side by side, in the middle of a merchant console. Both halves are for us: `code` is the
 * stable thing a client branches on, and `detail` is already written for a human. What was missing
 * is the translation from "an HTTP failure" to "something you can act on", so that lives here,
 * once, instead of in every screen that renders an error.
 *
 * A 401 is the one case that gets a real sentence rather than the envelope's: a session that
 * expired mid-visit is not an error state to read, it is a redirect that has not happened yet.
 * `onUnauthenticated` lets the caller perform it — the console's route guard does, and a public
 * page like customer tracking must not be bounced to a login screen it does not have.
 */
function messageFor(error: unknown): string {
  if (error instanceof ZipZapApiError) {
    if (error.status === 401) return 'Your session has ended. Sign in again to continue.';
    if (error.status === 403) return 'Your account does not have access to this.';
    if (error.status === 404) return 'We could not find that.';
    if (error.status === 429) {
      const wait = error.retryAfterSeconds;
      return wait
        ? `Too many requests. Try again in ${wait}s.`
        : 'Too many requests. Try again shortly.';
    }
    if (error.status >= 500) return 'ZipZap is having trouble. Nothing was saved — try again.';
    // 4xx that reached here has no friendlier mapping; the envelope detail is the
    // server's own wording and is written to be read.
    return error.envelope.detail || error.envelope.title;
  }
  return 'ZipZap is having trouble. Nothing was saved — try again.';
}
