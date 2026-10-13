import { useCallback, useEffect, useRef, useState } from 'react';
import { ZipZapApiError } from '@zipzap/api-client';

export interface Async<T> {
  readonly data: T | undefined;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
}

/** Fetch-on-mount. Same shape as every other screen in this repo, for the same reason. */
export function useAsync<T>(load: () => Promise<T>, key = ''): Async<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

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
