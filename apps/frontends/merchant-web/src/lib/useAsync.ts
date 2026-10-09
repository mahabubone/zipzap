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
        setError(e instanceof ZipZapApiError ? `${e.code}: ${e.envelope.detail}` : String(e));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [nonce, key]);

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []) };
}
