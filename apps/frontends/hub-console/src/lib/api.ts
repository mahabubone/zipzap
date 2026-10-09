import { ZipZapClient } from '@zipzap/api-client';
import { readSession } from './session.ts';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** A client bound to whatever session is stored. Recreated per call site on render —
 *  ZipZapClient is a thin fetch wrapper, so this is cheap and keeps the session
 *  read fresh after login/logout without a store. */
export function apiClient(): ZipZapClient {
  const session = readSession();
  return new ZipZapClient({ baseUrl, bearerToken: session?.token });
}

export function anonClient(): ZipZapClient {
  return new ZipZapClient({ baseUrl });
}
