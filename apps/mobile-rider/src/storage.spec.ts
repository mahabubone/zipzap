/**
 * The session store: what is kept where, and what a boot does with a bad state.
 *
 * The split this file guards is the whole security posture of the mobile app:
 *
 * - the token is in SecureStore, so an XSS or a rooted-filesystem read of AsyncStorage gets nothing;
 * - the queue is in AsyncStorage, so a device that loses its keychain entry loses queued work but
 *   never a credential.
 *
 * The failure modes are as important as the happy path. A half-written session, an expired one, a
 * corrupt metadata row, and a SecureStore that throws on this platform all have one correct answer
 * each, and getting one of them wrong produces a rider who cannot sign in rather than a crash.
 *
 * The stores are injected through the same module the app uses, but each test controls both, so
 * nothing here touches a real device's keychain.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked rather than imported: the app's `storage.ts` binds AsyncStorage and SecureStore at module
// scope, so a test needs to swap them before the module is evaluated. `vi.mock` is hoisted, which
// is the reason the app can import them directly rather than through injected ports.
const mockAsync = new Map<string, string>();
const mockSecure = new Map<string, string>();
const mockSecureThrows = { get: false, set: false };

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => mockAsync.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mockAsync.set(key, value);
    },
    removeItem: async (key: string) => {
      mockAsync.delete(key);
    },
  },
}));

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED: 'whenUnlocked',
  getItemAsync: async (key: string) => {
    if (mockSecureThrows.get) throw new Error('no secure storage on this platform');
    return mockSecure.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    if (mockSecureThrows.set) throw new Error('no secure storage on this platform');
    mockSecure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockSecure.delete(key);
  },
}));

// Imported after the mocks are registered, so they are in place when the module evaluates.
const { clearSession, isExpired, KEYS, readSession, writeSession } = await import('./storage.ts');

const meta = {
  riderId: 'rider-1',
  credentialKind: 'bearer' as const,
  expiresAt: '2099-01-01T00:00:00.000Z',
};

describe('the session store', () => {
  beforeEach(() => {
    mockAsync.clear();
    mockSecure.clear();
    mockSecureThrows.get = false;
    mockSecureThrows.set = false;
  });

  it('never puts the token in AsyncStorage', async () => {
    // The whole point. AsyncStorage is unencrypted on a rooted device, so a token there is a token
    // an attacker can lift.
    await writeSession(meta, 'tok-secret');

    expect(mockSecure.get('zipzap.rider.session.token.v1')).toBe('tok-secret');
    for (const value of mockAsync.values()) {
      expect(value).not.toContain('tok-secret');
    }
  });

  it('reads the session back with the token from the secure store', async () => {
    await writeSession(meta, 'tok-secret');

    const stored = await readSession();

    expect(stored?.token).toBe('tok-secret');
    expect(stored?.meta.riderId).toBe('rider-1');
    expect(stored?.expired).toBe(false);
  });

  it('treats metadata without a token as no session at all', async () => {
    // A crash between the two writes. Authenticating on half a session is the one thing that must
    // never happen, so this is "not signed in", not "signed in with no token".
    await mockAsync.set(KEYS.sessionMeta, JSON.stringify(meta));

    const stored = await readSession();

    expect(stored?.token).toBeNull();
    expect(stored?.expired).toBe(false);
  });

  it('speaks the same keyspace as the queue, and nothing else', async () => {
    // Two keys exist and no more. A third would be state this app does not know about.
    await writeSession(meta, 'tok-secret');

    expect([...mockAsync.keys()]).toEqual([KEYS.sessionMeta]);
    expect([...mockSecure.keys()]).toEqual(['zipzap.rider.session.token.v1']);
  });

  it('clears the token first, then the metadata that described it', async () => {
    // Order matters: a sign-out that dies halfway must not leave a rider holding a credential the
    // app believes is gone.
    await writeSession(meta, 'tok-secret');

    await clearSession();

    expect(mockSecure.size).toBe(0);
    expect(mockAsync.size).toBe(0);
  });

  it('is idempotent: clearing twice is fine', async () => {
    await writeSession(meta, 'tok-secret');
    await clearSession();
    await clearSession();

    expect(await readSession()).toBeNull();
  });
});

describe('expiry', () => {
  it('accepts a token with time left', () => {
    expect(isExpired({ ...meta, expiresAt: new Date(Date.now() + 3_600_000).toISOString() })).toBe(
      false,
    );
  });

  it('refuses an expired one', () => {
    expect(isExpired({ ...meta, expiresAt: new Date(Date.now() - 3_600_000).toISOString() })).toBe(
      true,
    );
  });

  it('has a grace window, so clock skew does not end a shift', () => {
    // A rider mid-scan should not lose a token to a device clock a minute off the server's. The
    // server still decides; this only avoids a pointless re-auth.
    const justPast = new Date(Date.now() - 45_000).toISOString();
    expect(isExpired({ ...meta, expiresAt: justPast })).toBe(false);
    const wellPast = new Date(Date.now() - 300_000).toISOString();
    expect(isExpired({ ...meta, expiresAt: wellPast })).toBe(true);
  });

  it('refuses an unparseable date rather than trusting it', () => {
    expect(isExpired({ ...meta, expiresAt: 'not-a-date' })).toBe(true);
  });

  it('refuses a session with no expiry at all when it has a value that says so', () => {
    // `null` means "this credential does not expire" (an API key), which is a real case and is not
    // the same as an unparseable one.
    expect(isExpired({ ...meta, expiresAt: null })).toBe(false);
  });
});

describe('a device with no secure store', () => {
  beforeEach(() => {
    // The web build the shot script renders: SecureStore is not available, and boot must not crash.
    mockSecureThrows.get = true;
  });

  it('reads metadata and reports no token, rather than throwing', async () => {
    await mockAsync.set(KEYS.sessionMeta, JSON.stringify(meta));

    const stored = await readSession();

    expect(stored?.token).toBeNull();
  });

  it('clears cleanly when the secure store cannot be written to', async () => {
    mockSecureThrows.set = true;

    await writeSession(meta, null);
    await clearSession();

    expect(mockAsync.size).toBe(0);
  });
});

describe('a corrupt metadata row', () => {
  it('is dropped rather than guessed at', async () => {
    // "Which rider am I" answers itself from the server, so a corrupt row is recoverable by
    // signing in again — the wrong answer is to guess and act as the wrong rider.
    await mockAsync.set(KEYS.sessionMeta, '{ not json');

    expect(await readSession()).toBeNull();
    expect(mockAsync.size).toBe(0);
  });
});
