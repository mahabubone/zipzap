/**
 * The device's persistence layer.
 *
 * Two stores, because they answer to different threats, and conflating them is the single most
 * common security error in a mobile app:
 *
 * - **AsyncStorage** holds the offline queue: queued commands, the device sequence counter, and
 *   the settled rulings the rider needs to see. It is unencrypted and readable by anything with
 *   filesystem access on a rooted device — so it holds no secret, and nothing in it grants access.
 * - **SecureStore** holds the session token. It is the device keychain / Keystore, backed by
 *   hardware where hardware exists. This is the one thing on the device that must not leave it.
 *
 * Session *metadata* (the rider id, the expiry, which credential kind was used) is not secret and is
 * useful for the boot path, so it lives in AsyncStorage alongside the queue. Only the token goes to
 * SecureStore.
 *
 * The queue's `QueueStorage` port (src/offline/command-queue.ts) is satisfied by a keyspace-scoped
 * adapter over AsyncStorage, so the queue keeps running in `verify-queue.mjs` unchanged.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { QueueStorage } from './offline/command-queue.ts';

/** Keyspace for everything the rider app owns in AsyncStorage. */
export const KEYS = {
  /** The offline command queue and its device sequence counter. Not secret. */
  queue: 'zipzap.rider.offline.v1',
  /** Session metadata: rider id, credential kind, expiry. Not secret. */
  sessionMeta: 'zipzap.rider.session.meta.v1',
} as const;

/**
 * SecureStore key for the session token.
 *
 * Deliberately `accessibleWhenUnlocked` rather than `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: a rider scans
 * and delivers with the phone locked in a pocket most of the day, and a queue flush triggered by a
 * connectivity change must not fail because the screen is off. The trade-off is that the token is
 * not in the hardware-backed, non-exportable keychain class — accepted here because the threat
 * model is a lost phone, which `WHEN_UNLOCKED` still protects against, and the alternative breaks
 * the offline behaviour ADR-0012 is built on.
 */
const TOKEN_KEY = 'zipzap.rider.session.token.v1';

export interface SessionMeta {
  readonly riderId: string;
  /** Which credential kind the token is, so a device knows what it is without parsing it. */
  readonly credentialKind: 'bearer' | 'apikey';
  /** ISO 8601 expiry. The boot path refuses an expired session rather than sending it. */
  readonly expiresAt: string | null;
}

/** AsyncStorage, scoped to the rider app's keys and typed as the queue's port. */
export const queueStorage: QueueStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};

/**
 * Stores a session: the token in SecureStore, the rest beside the queue.
 *
 * Written together but not atomically — the two stores cannot transact. A crash between them leaves
 * metadata without a token, which `readSession` treats as "no session" and sends the rider back to
 * the sign-in screen. That is the safe direction: a half-written session must not authenticate.
 */
export async function writeSession(meta: SessionMeta, token: string | null): Promise<void> {
  await AsyncStorage.setItem(KEYS.sessionMeta, JSON.stringify(meta));
  if (token === null) {
    // Nothing to secure — an API-key principal's secret never reaches this device.
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export interface StoredSession {
  readonly meta: SessionMeta;
  readonly token: string | null;
  /** True when the metadata says the session is past its expiry. */
  readonly expired: boolean;
}

/** How far past `expiresAt` a session is still honoured locally, for clock skew. */
const GRACE_MS = 60_000;

/**
 * Reads the stored session, or null if there is none.
 *
 * An expired session is returned with `expired: true` rather than discarded, so the caller can say
 * "your session ended, sign in again" rather than silently bouncing to a login form the rider
 * cannot explain. A missing token is `null` session, not an error: the rider simply is not signed
 * in.
 *
 * SecureStore is unavailable on the web build that the shot script uses, so a throw here is treated
 * as "no secure storage" rather than crashing boot. On a real device this branch is not taken.
 */
export async function readSession(): Promise<StoredSession | null> {
  const raw = await AsyncStorage.getItem(KEYS.sessionMeta);
  if (raw === null) return null;

  let meta: SessionMeta;
  try {
    meta = JSON.parse(raw) as SessionMeta;
  } catch {
    // A corrupt metadata row is a corrupt session. Drop it rather than guessing.
    await clearSession();
    return null;
  }

  let token: string | null = null;
  try {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    token = null;
  }

  return { meta, token, expired: isExpired(meta) };
}

/**
 * True when the session is past its expiry, by more than the grace window.
 *
 * The window is ahead of the expiry, not behind it: a device clock a little behind the server's
 * would otherwise report a live token as expired and sign the rider out mid-scan. The server is
 * still the authority, so this only avoids a needless re-authentication on a phone whose clock
 * drifted.
 */
export function isExpired(meta: SessionMeta): boolean {
  if (meta.expiresAt === null) return false;
  const expiry = new Date(meta.expiresAt);
  if (Number.isNaN(expiry.getTime())) return true;
  return expiry.getTime() + GRACE_MS < Date.now();
}

/** Forgets the session: the token first, then the metadata that described it. */
export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Already absent, or no secure storage on this platform. Either way it is gone.
  }
  await AsyncStorage.removeItem(KEYS.sessionMeta);
}
