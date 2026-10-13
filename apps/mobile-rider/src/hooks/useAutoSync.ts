/**
 * Auto-sync on connectivity, with exponential backoff.
 *
 * Sync was a button the rider had to press. That is a design that loses work in a specific and
 * predictable way: the rider scans in a basement, walks outside, gets two bars, and does not know
 * they have to go find the Sync tab. The queue holds everything — ADR-0012 guarantees the scan
 * survives — but "survives" is small consolation for a scan that does not count until tomorrow.
 *
 * So this watches connectivity and flushes when it returns. The rules:
 *
 * - **A glitch that violates constraint 3 is not a rejection.** The queue replays with the same
 *   `deviceSequence` on every attempt, so replaying after a half-sent request is safe by
 *   construction and the rider must never be told their work failed when it was not even read.
 * - **Backoff with jitter.** A rider walking through a dead zone is a flapping connectivity source;
 *   without jitter, every device on the same site retries in lockstep.
 * - **Backoff resets on success.** Otherwise a long outage leaves the device permanently timid.
 * - **A `COMMAND_QUEUE_FULL` 409 is treated as "keep everything".** The server refuses the whole
 *   batch at the cap, so retrying after it can never help and would spin.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import type { RiderClient } from '../rider-client.ts';

/** The first attempt is immediate; after that, `BASE_MS * 2^attempt`. */
const BASE_MS = 2_000;
const MAX_MS = 60_000;
/** Never more than this many consecutive failures before surfacing "needs attention". */
const MAX_ATTEMPTS = 8;

export interface AutoSyncState {
  /** True while a flush is in flight. */
  readonly syncing: boolean;
  /** The last flush's ruling, for the badge on the Sync tab. */
  readonly lastOutcome: 'idle' | 'ok' | 'partial' | 'failed';
  /** Why the last flush did not fully succeed, when it did not. */
  readonly lastError: string | null;
  /** True when connectivity is known-absent. */
  readonly offline: boolean;
  /** Consecutive failures. Reaches `MAX_ATTEMPTS` and stops. */
  readonly attempts: number;
}

export interface AutoSync extends AutoSyncState {
  /** Flush now, bypassing the connectivity check. Used by the button on the Sync screen. */
  readonly syncNow: () => Promise<void>;
  /** Reset the backoff after a manual success. */
  readonly reset: () => void;
}

export function useAutoSync(
  client: RiderClient | null,
  onPendingChange: (pending: number) => void,
): AutoSync {
  const [state, setState] = useState<AutoSyncState>({
    syncing: false,
    lastOutcome: 'idle',
    lastError: null,
    offline: false,
    attempts: 0,
  });
  /** Ref rather than state: the retry timer must read the current count without re-subscribing. */
  const attemptsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const sync = useCallback(async (): Promise<void> => {
    if (client === null || inFlightRef.current) return;
    inFlightRef.current = true;
    setState((s) => ({ ...s, syncing: true }));

    try {
      const result = await client.sync();

      const rejected = result.settled.filter((r) => r.kind === 'rejected');
      onPendingChange(result.queueRemaining);

      if (rejected.length > 0) {
        // A partial success is not a failure to retry: the commands applied, and the rest carry a
        // ruling. Retrying would re-refuse them forever, which is the failure mode rule 2 of the
        // queue exists to avoid.
        setState((s) => ({
          ...s,
          lastOutcome: 'partial',
          lastError: rejected.map((r) => reasonOf(r)).join('; '),
        }));
      } else {
        attemptsRef.current = 0;
        setState((s) => ({ ...s, lastOutcome: 'ok', lastError: null, attempts: 0 }));
      }
    } catch (error) {
      attemptsRef.current += 1;
      setState((s) => ({
        ...s,
        lastOutcome: attemptsRef.current >= MAX_ATTEMPTS ? 'failed' : 'idle',
        lastError: messageOf(error),
        attempts: attemptsRef.current,
      }));
    } finally {
      inFlightRef.current = false;
      setState((s) => ({ ...s, syncing: false }));
    }
  }, [client, onPendingChange]);

  /** Schedule the next attempt, or stop after `MAX_ATTEMPTS`. */
  const scheduleRetry = useCallback(() => {
    clearTimer();
    if (attemptsRef.current >= MAX_ATTEMPTS) return;
    // Jitter is not cosmetic here: a depot of riders losing signal together would otherwise
    // re-connect in lockstep and stampede the API on the same millisecond.
    const backoff = Math.min(BASE_MS * 2 ** attemptsRef.current, MAX_MS);
    const jitter = Math.random() * backoff * 0.3;
    timerRef.current = setTimeout(() => {
      void sync();
    }, backoff + jitter);
  }, [clearTimer, sync]);

  // Flush when connectivity comes back.
  useEffect(() => {
    if (client === null) return undefined;
    const unsubscribe = NetInfo.addEventListener((status) => {
      const online = status.isConnected === true && status.isInternetReachable !== false;
      setState((s) => ({ ...s, offline: !online }));
      if (online) {
        attemptsRef.current = 0;
        void sync();
      } else {
        clearTimer();
      }
    });
    return unsubscribe;
  }, [client, sync, clearTimer]);

  // Retry after a failure, and clean up on unmount.
  useEffect(() => {
    if (state.lastOutcome === 'idle' && state.attempts > 0) scheduleRetry();
    return clearTimer;
  }, [state.lastOutcome, state.attempts, scheduleRetry, clearTimer]);

  const syncNow = useCallback(async () => {
    attemptsRef.current = 0;
    clearTimer();
    await sync();
  }, [sync, clearTimer]);

  const reset = useCallback(() => {
    attemptsRef.current = 0;
    clearTimer();
    setState((s) => ({ ...s, attempts: 0, lastError: null, lastOutcome: 'idle' }));
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { ...state, syncNow, reset };
}

function reasonOf(ruling: { reason?: string | null }): string {
  return ruling.reason ?? 'unknown';
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
