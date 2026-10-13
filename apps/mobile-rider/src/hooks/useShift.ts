/**
 * The rider's shift, as a hook.
 *
 * The rules live in `rules/shift.ts`; this is the storage and re-render wiring around them. The hook
 * answers three questions and nothing else: is there a shift, whose is it, and how long has it run.
 *
 * A shift is written on sign-in and on an explicit toggle, and **never** silently: a rider who opens
 * the app mid-week must not find yesterday's parcels listed as today's work, which is why the caller
 * decides when a shift starts rather than the hook deciding on mount.
 */

import { useCallback, useEffect, useState } from 'react';
import { activeShift, formatDuration, startShift, type ActiveShift } from '../rules/shift.ts';
import { clearShift, readShift, writeShift } from '../storage.ts';

/** What the hook gives a screen. */
export interface RiderShift {
  /** The running shift, or null when the rider is off shift. */
  readonly active: ActiveShift | null;
  /** True while the stored shift is being read on mount. */
  readonly loading: boolean;
  /** Start a shift for this rider, replacing whatever was there. */
  readonly start: (riderId: string) => Promise<void>;
  /** End the shift, leaving every queued command alone. */
  readonly end: () => Promise<void>;
}

export function useShift(riderId: string): RiderShift {
  const [shift, setShift] = useState<ActiveShift | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const stored = await readShift();
    // A shift that belongs to another rider is not this rider's shift. On a shared depot device the
    // previous rider's shift must not become this rider's work stream, which is the whole reason the
    // rider id is checked rather than just the timestamp.
    setShift(stored && stored.riderId === riderId ? activeShift(stored) : null);
  }, [riderId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await reload();
      // A caller that unmounted mid-read must not be handed a setState.
      if (cancelled) return;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const start = useCallback(async (rider: string) => {
    const next = startShift(rider);
    await writeShift(next);
    setShift(activeShift(next));
  }, []);

  const end = useCallback(async () => {
    await clearShift();
    setShift(null);
  }, []);

  return { active: shift, loading, start, end };
}

/** Re-exported so a screen formats a duration without reaching into the rules file. */
export { formatDuration };
