import { ZipZapClient } from '@zipzap/api-client';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

/** No session, by design. A recipient has a tracking code, not an account — this
 *  app must never be able to send a bearer token even by accident. */
export function anonClient(): ZipZapClient {
  return new ZipZapClient({ baseUrl });
}
