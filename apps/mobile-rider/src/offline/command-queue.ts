/**
 * The rider's offline command queue. Framework-free, and deliberately so.
 *
 * This is the half of the offline protocol that lives on the phone, and it is the half that decides
 * whether a rider's day survives a dead network. Three rules, each of which exists because the
 * obvious alternative loses a rider's work:
 *
 * 1. **`deviceSequence` is ours and monotonic.** It is minted here, on the device, and it never
 *    resets — not on a restart, not on a reinstall. It is half of the dedupe key with the server, so
 *    a batch re-sent on a flaky link is applied exactly once. The server also owns a unique index on
 *    it; this is the client half of that guarantee.
 * 2. **A rejected command is not retried.** The server's `reason` is the rider's only clue, so it is
 *    kept, not swallowed. Retrying a command the server refused because a parcel was cancelled would
 *    re-refuse forever and hide a real problem behind a spinner.
 * 3. **The cap warns before it bites.** ADR-0012's stated consequence: "storage grows unboundedly if
 *    a device stays offline". At the warning threshold the rider is told to find signal; at the cap
 *    the queue refuses, which is the safe direction — losing a scan the rider was told was accepted
 *    is far worse than refusing the hundred-and-first.
 *
 * Rule 3 applies to this file as AGENTS.md's rule 3 does to a backend `rules/` directory: no React
 * Native, no Expo, no AsyncStorage import. The queue takes a `Storage`-shaped port, so the same code
 * runs on a phone and inside `verify-queue.mjs`.
 */

export interface QueuedCommand {
  readonly deviceSequence: number;
  readonly createdAt: string;
  readonly commandType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** What the device believed at the time. The server compares this against reality. */
  readonly expectedState: Readonly<Record<string, unknown>>;
}

/** One command after the server has ruled on it. `reason` is what the rider reads. */
export type Settled =
  | { readonly kind: 'applied'; readonly deviceSequence: number }
  | { readonly kind: 'rejected'; readonly deviceSequence: number; readonly reason: string }
  | { readonly kind: 'duplicate'; readonly deviceSequence: number; readonly serverSaid: string };

/** What the queue needs from the device's key-value store. AsyncStorage satisfies this exactly. */
export interface QueueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export class QueueFullError extends Error {
  // Plain fields rather than `constructor(readonly size: number)`: Node's type stripping — which is
  // how verify-queue.mjs runs this file with no build step — does not support parameter properties.
  readonly size: number;
  readonly cap: number;

  constructor(size: number, cap: number) {
    super(`Offline queue is full (${size}/${cap}). Find a signal to sync.`);
    this.name = 'QueueFullError';
    this.size = size;
    this.cap = cap;
  }
}

const KEY = 'zipzap.rider.offline.v1';

export interface QueueState {
  /** The next sequence to mint. Persisted so a restart never reuses one. */
  readonly nextSequence: number;
  readonly pending: readonly QueuedCommand[];
  readonly settled: readonly Settled[];
}

const EMPTY: QueueState = { nextSequence: 1, pending: [], settled: [] };

export class OfflineQueue {
  private readonly storage: QueueStorage;
  private readonly cap: number;

  constructor(storage: QueueStorage, cap = 100) {
    this.storage = storage;
    this.cap = cap;
  }

  /** Warn at 90%, matching the server. A threshold that differs per device is a threshold nobody trusts. */
  get warningAt(): number {
    return Math.floor(this.cap * 0.9);
  }

  private async read(): Promise<QueueState> {
    const raw = await this.storage.getItem(KEY);
    if (!raw) return EMPTY;
    try {
      const parsed = JSON.parse(raw) as QueueState;
      // A corrupt blob must not brick the app. An empty queue loses a day of scans, but a throw here
      // loses the app — and the rider can still redo today's work. Losing is the smaller evil, so
      // this returns EMPTY rather than throwing.
      if (!Array.isArray(parsed.pending) || typeof parsed.nextSequence !== 'number') return EMPTY;
      return parsed;
    } catch {
      return EMPTY;
    }
  }

  private async write(state: QueueState): Promise<void> {
    await this.storage.setItem(KEY, JSON.stringify(state));
  }

  async pending(): Promise<readonly QueuedCommand[]> {
    return (await this.read()).pending;
  }

  async settled(): Promise<readonly Settled[]> {
    return (await this.read()).settled;
  }

  /** True once the queue is close enough to the cap that the rider should be told. */
  async capWarning(): Promise<boolean> {
    return (await this.read()).pending.length >= this.warningAt;
  }

  async remainingCapacity(): Promise<number> {
    return this.cap - (await this.read()).pending.length;
  }

  /**
   * Record a command taken offline. Throws `QueueFullError` at the cap rather than dropping it
   * silently — a scan the rider was told was accepted and then vanished is the one failure this app
   * cannot have.
   */
  async append(
    command: Omit<QueuedCommand, 'deviceSequence' | 'createdAt'>,
    now: Date = new Date(),
  ): Promise<QueuedCommand> {
    const state = await this.read();
    if (state.pending.length >= this.cap) {
      throw new QueueFullError(state.pending.length, this.cap);
    }
    const queued: QueuedCommand = {
      ...command,
      deviceSequence: state.nextSequence,
      createdAt: now.toISOString(),
    };
    await this.write({
      ...state,
      // Minted and persisted in the same write, so a crash between the two cannot reuse a sequence.
      nextSequence: state.nextSequence + 1,
      pending: [...state.pending, queued],
    });
    return queued;
  }

  /**
   * What to send, in the order the server will apply it.
   *
   * Ordered by `createdAt` with `deviceSequence` breaking ties — the same total order the server
   * imposes, so the phone and the server agree on what happened first. Sending arrival order would
   * work today and diverge the first time the network reorders two requests.
   */
  async outbound(): Promise<readonly QueuedCommand[]> {
    return [...(await this.read()).pending].sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.deviceSequence - b.deviceSequence,
    );
  }

  /**
   * Fold the server's ruling back in.
   *
   * Anything the server did not mention stays pending — including a `duplicate` whose command was
   * never in this queue, which cannot happen, so a `duplicate` we do not recognise is recorded rather
   * than dropped. Losing a command the server has already ruled on would leave the rider's local
   * queue permanently one ahead of reality.
   */
  async reconcile(results: readonly Settled[], serverQueueFull = false): Promise<void> {
    if (serverQueueFull) return; // Nothing was ruled on. Keep everything and try again.
    const state = await this.read();
    const ruled = new Set(results.map((r) => r.deviceSequence));
    const pending = state.pending.filter((c) => !ruled.has(c.deviceSequence));
    // Only claims we can match. A `duplicate` for a sequence this queue never minted is a symptom,
    // and silently believing it would delete a command we still owe the server.
    const settled = [
      ...state.settled,
      ...results.filter((r) => state.pending.some((c) => c.deviceSequence === r.deviceSequence)),
    ];
    await this.write({ ...state, pending, settled });
  }

  async clear(): Promise<void> {
    await this.write(EMPTY);
  }
}
