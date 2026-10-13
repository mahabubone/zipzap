import { useCallback, useEffect, useRef, useState } from 'react';
import { ZipZapApiError } from '@zipzap/api-client';

export interface Async<T> {
  readonly data: T | undefined;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
}

/**
 * Fetch-on-mount for a screen. One shape for data/error/loading so no screen hand-rolls the same
 * three `useState`s.
 *
 * `key` re-runs the fetch when it changes. A screen whose query lives in state (a cursor, a filter)
 * passes it here instead of calling `reload()` from an effect — that would fetch once with the old
 * value and once with the new.
 *
 * ## Why this lives in one package
 *
 * Four apps had this hook and only the merchant console's had `messageFor`. The other three rendered
 * `${code}: ${detail}`, which put `AUTHENTICATION_REQUIRED: AuthenticationRequiredError` in the
 * middle of an operator's screen — the exact output the merchant copy's own comment said was
 * unacceptable, shipped three times over. Three copies of a fetch hook is one copy of the bug and
 * two copies of the fix.
 *
 * ponytail: no cache and no request dedupe — every mount refetches. Add @tanstack/react-query when a
 * second screen needs the same list, or when a mutation must invalidate something this fetched.
 */
export function useAsync<T>(load: () => Promise<T>, key = ''): Async<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // Held in a ref so a caller passing an inline closure does not re-fetch on every render — the
  // effect keys off `nonce` alone.
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
 * It used to be `${code}: ${detail}`, which rendered as `AUTHENTICATION_REQUIRED:
 * AuthenticationRequiredError` — a machine code and a TypeScript class name side by side in the
 * middle of a console. Both halves are for us: `code` is the stable thing a client branches on, and
 * `detail` is already written for a human. What was missing is the translation from "an HTTP
 * failure" to "something you can act on", which lives here, once.
 *
 * A 401 gets a real sentence rather than the envelope's: a session that expired mid-visit is not an
 * error state to read, it is a redirect that has not happened yet. Public screens render it as
 * text — a recipient has no session to sign in to.
 */
export function messageFor(error: unknown): string {
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
    // A 4xx that reached here has no friendlier mapping; the envelope detail is the server's own
    // wording and is written to be read.
    return error.envelope.detail || error.envelope.title;
  }
  return 'ZipZap is having trouble. Nothing was saved — try again.';
}
