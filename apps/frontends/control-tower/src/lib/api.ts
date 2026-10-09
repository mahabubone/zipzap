import { ZipZapClient } from '@zipzap/api-client';
import { readSession } from './session.ts';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export function apiClient(): ZipZapClient {
  const session = readSession();
  return new ZipZapClient({ baseUrl, bearerToken: session?.token });
}

export function anonClient(): ZipZapClient {
  return new ZipZapClient({ baseUrl });
}
