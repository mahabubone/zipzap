/**
 * Offline sync server contract (Phase 5 rung 4).
 *
 * A rider that goes offline queues commands locally; on reconnection the server replays them
 * in `created_at` order. Each command may carry `expected_state` — the aggregate snapshot at
 * enqueue time. The server validates it against current state: a mismatch is a **recorded
 * rejection with a reason**, never a silent drop, and the device is told why. Commands that are
 * already acked are replayed byte-for-byte with the recorded outcome — the rider learns exactly
 * what happened, no retries, no surprises.
 *
 * Pending pulls are capped (`RIDER_COMMAND_QUEUE_CAP`, default 100) with a 90% warning so a
 * rider that stays offline indefinitely does not grow the queue without bound.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { CommandQueueFullError } from '../../common/domain-error.ts';
import { hashRequest } from '../../common/idempotency.ts';
import { InvalidIdempotencyKeyError } from '../../common/domain-error.ts';
import { claim } from '../system/idempotency.store.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { CommandQueueRepository, type PendingCommandRow } from './command-queue.repository.ts';
import { RiderRepository } from './rider.repository.ts';

const CAP = Number(process.env.RIDER_COMMAND_QUEUE_CAP) || 100;
const CAP_WARNING_THRESHOLD = CAP * 0.9;

export interface PullCommand {
  readonly id: string;
  readonly commandType: string;
  readonly payload: Readonly<object>;
  readonly expectedState: Readonly<object> | null;
  readonly deviceSequence: number;
  readonly createdAt: Date;
}

export interface PullResult {
  readonly commands: readonly PullCommand[];
  readonly queueSize: number;
  readonly capWarning: boolean;
}

export interface ValidateResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/** Validator runs inside the ack transaction and decides whether a queued command still applies. */
export type Validator = (
  manager: import('typeorm').EntityManager,
  command: PendingCommandRow,
) => Promise<ValidateResult>;

export const OFFLINE_SYNC_COMMAND_TYPE = 'zipzap.rider.command' as const;

export interface RiderCommandDeliveredPayload {
  readonly commandId: string;
  readonly deviceSequence: number;
  readonly commandType: string;
}

export interface RiderCommandRejectedPayload {
  readonly commandId: string;
  readonly deviceSequence: number;
  readonly commandType: string;
  readonly reason: string;
}

export type AckOutcome =
  | { readonly kind: 'delivered'; readonly replayed: false }
  | { readonly kind: 'rejected'; readonly replayed: false }
  | { readonly kind: 'already_delivered'; readonly replayed: true }
  | { readonly kind: 'already_rejected'; readonly replayed: true };

export interface AckResult {
  readonly outcome: AckOutcome;
  readonly createdAt: Date;
}

/**
 * One command as a device recorded it, offline.
 *
 * `createdAt` is the *device's* clock, not the server's — that is the whole reason replay orders by
 * it (ADR-0012). A device whose clock is wrong still gets a total order among its own commands,
 * because `deviceSequence` breaks ties.
 */
export interface DeviceCommand {
  readonly deviceSequence: number;
  readonly createdAt: Date;
  readonly commandType: string;
  readonly payload: object;
  readonly expectedState?: object | null;
}

/**
 * Why one replayed command ended the way it did.
 *
 * `duplicate` is not an error and not a no-op: it means this `(rider_id, device_sequence)` was
 * already submitted, and `reason` carries what happened then, so the device can reconcile its local
 * queue against the server instead of guessing. Without it a rider who reconnected on a flaky link
 * would have no way to know which of their 40 scans had landed.
 */
export type ReplayOutcomeKind = 'applied' | 'rejected' | 'duplicate';

export interface ReplayOutcome {
  readonly deviceSequence: number;
  readonly commandId: string;
  readonly kind: ReplayOutcomeKind;
  /** Human-readable, and the rider reads it. Null only when there is nothing to say. */
  readonly reason: string | null;
}

export interface ReplayResult {
  readonly results: readonly ReplayOutcome[];
  readonly queueSize: number;
  readonly capWarning: boolean;
}

/** Registry of per-command-type validators injected by the module that owns the
 * aggregate semantics. A command type with no validator is unconditional (always valid). */
export const OFFLINE_SYNC_VALIDATORS = Symbol('offlineSyncValidators');

@Injectable()
export class OfflineSyncService {
  constructor(
    @InjectDataSource('rider') private readonly rider: DataSource,
    @Inject(CommandQueueRepository) private readonly queue: CommandQueueRepository,
    @Inject(RiderRepository) private readonly riders: RiderRepository,
    @Inject(OFFLINE_SYNC_VALIDATORS)
    private readonly validators: Record<string, Validator> = {},
  ) {}

  /**
   * Pull pending commands for a rider, ordered by creation.
   *
   * `sinceSeq` is the rider's last acknowledged device sequence (replay only what is new);
   * `limit` caps the window (defaults to the queue cap). Returns the queue size for the
   * caller's cap alerting.
   */
  async pull(riderId: string, sinceSeq?: number, limit?: number): Promise<PullResult> {
    return this.rider.transaction(async (manager) => {
      const rider = await this.riders.findById(manager, riderId);
      if (!rider) {
        throw new ResourceNotFoundError(`Rider ${riderId} not found.`);
      }

      const limitValue = limit ?? CAP;
      const rows = await this.queue.findPendingCommands(manager, riderId, sinceSeq, limitValue);
      const { count: countStr } = await this.queue.countPending(manager, riderId);
      const queueSize = Number(countStr);

      const commands: readonly PullCommand[] = rows.map((row) => ({
        id: row.id,
        commandType: row.command_type,
        payload: row.payload as Readonly<object>,
        expectedState: row.expected_state as Readonly<object> | null,
        deviceSequence: row.device_sequence,
        createdAt: row.created_at,
      }));

      return { commands, queueSize, capWarning: queueSize >= CAP_WARNING_THRESHOLD };
    });
  }

  /**
   * Enqueue a command from an offline rider's device. Idempotent on
   * `(rider_id, device_sequence)`. Rejects when the pending queue has hit the cap.
   */
  async enqueue(
    riderId: string,
    deviceSequence: number,
    commandType: string,
    payload: object,
    expectedState?: object | null,
  ): Promise<{ queueSize: number; capWarning: boolean }> {
    return this.rider.transaction(async (manager) => {
      const rider = await this.riders.findById(manager, riderId);
      if (!rider) {
        throw new ResourceNotFoundError(`Rider ${riderId} not found.`);
      }

      const { count: countStr } = await this.queue.countPending(manager, riderId);
      const queueSize = Number(countStr);
      if (queueSize >= CAP) {
        throw new CommandQueueFullError(queueSize, CAP);
      }

      const inserted = await this.queue.enqueue(manager, {
        id: randomUUID(),
        riderId,
        deviceSequence,
        commandType,
        payload,
        expectedState: expectedState ?? null,
        createdAt: new Date(),
      });
      if (!inserted) {
        // The row is already there. The single-command path has no per-command outcome to report, so
        // it reports the queue as it stands — which is the honest answer, and better than the raw
        // unique violation this used to raise.
        return { queueSize, capWarning: queueSize >= CAP_WARNING_THRESHOLD };
      }

      const { count: newCountStr } = await this.queue.countPending(manager, riderId);
      return { queueSize: Number(newCountStr), capWarning: queueSize + 1 >= CAP_WARNING_THRESHOLD };
    });
  }

  /**
   * Acknowledge one queued command.
   *
   * Idempotent: claims the key inside the transaction before any work. The command must belong
   * to the given rider (ownership verified in the same transaction). A mismatch between the
   * rider's recorded `expected_state` and current aggregate state is a **recorded rejection with
   * a reason** — never a silent drop. Already-acked commands are replayed byte-for-byte with the
   * recorded outcome.
   */
  async acknowledge(
    commandId: string,
    riderId: string,
    idempotencyKey: string,
    body: object,
  ): Promise<AckResult & { replayed?: boolean }> {
    return this.rider.transaction(async (manager) => {
      const claimed = await claim(
        manager,
        { scope: 'rider.sync-ack', merchantId: null, key: idempotencyKey },
        hashRequest(body),
      );

      if (claimed.decision.outcome === 'key_reuse') {
        throw new InvalidIdempotencyKeyError(
          'This Idempotency-Key was used with a different body.',
        );
      }
      if (claimed.decision.outcome === 'replay') {
        // The first ack already recorded the outcome. Return the already_* variant
        // with top-level replayed:true so the client knows this response is from a prior ack.
        const row = await this.queue.findCommand(manager, commandId);
        if (!row) {
          return claimed.decision.responseBody as AckResult & { replayed: true };
        }
        if (row.acknowledgedAt) {
          return {
            outcome: { kind: 'already_delivered', replayed: true },
            createdAt: row.createdAt,
            replayed: true,
          };
        }
        if (row.rejectedAt) {
          return {
            outcome: { kind: 'already_rejected', replayed: true },
            createdAt: row.createdAt,
            replayed: true,
          };
        }
        // Pending row + claimed key -> replay the stored outcome as-is.
        return claimed.decision.responseBody as AckResult & { replayed: true };
      }

      const row = await this.queue.findCommand(manager, commandId);
      if (!row || row.riderId !== riderId) {
        throw new ResourceNotFoundError(`Command ${commandId} not found.`);
      }

      // Already acked -> replay the recorded outcome, never a second delivery.
      if (row.acknowledgedAt) {
        return { outcome: { kind: 'already_delivered', replayed: true }, createdAt: row.createdAt };
      }
      if (row.rejectedAt) {
        return { outcome: { kind: 'already_rejected', replayed: true }, createdAt: row.createdAt };
      }

      // Pending -> validate, then mark once (append-only markers).
      const applied = await this.apply(manager, {
        id: row.id,
        rider_id: row.riderId,
        device_sequence: row.deviceSequence,
        command_type: row.commandType,
        payload: row.payload as object,
        expected_state: row.expectedState,
        created_at: row.createdAt,
      });

      if (applied.kind === 'applied') {
        const delivered: AckResult = {
          outcome: { kind: 'delivered', replayed: false },
          createdAt: row.createdAt,
        };
        await claimed.complete(200, delivered);
        return delivered;
      }

      const rejected: AckResult = {
        outcome: { kind: 'rejected', replayed: false },
        createdAt: row.createdAt,
      };
      await claimed.complete(200, rejected);
      return rejected;
    });
  }

  /**
   * Validate a pending command, mark it once, and write the outbox row — the whole of "apply".
   *
   * Extracted because `acknowledge` and `replay` must not be able to disagree about what applying a
   * command means. A copy here would let the batch path accept a state the single path rejects, and
   * the divergence would only show up as a device that behaves differently depending on how it
   * reconnected.
   */
  private async apply(
    manager: import('typeorm').EntityManager,
    row: PendingCommandRow,
  ): Promise<{ kind: 'applied' } | { kind: 'rejected'; reason: string }> {
    const validator = this.validators[row.command_type];
    const result = validator
      ? await validator(manager, row)
      : { valid: true, reason: undefined as string | undefined };

    if (result.valid) {
      await this.queue.markDelivered(manager, row.id);
      await appendOutbox(manager, {
        type: 'RiderCommandDelivered',
        aggregateType: 'rider',
        aggregateId: row.rider_id,
        payload: {
          commandId: row.id,
          deviceSequence: row.device_sequence,
          commandType: row.command_type,
        },
      });
      return { kind: 'applied' };
    }

    const reason = result.reason ?? 'state mismatch';
    await this.queue.markRejected(manager, row.id, reason);
    await appendOutbox(manager, {
      type: 'RiderCommandRejected',
      aggregateType: 'rider',
      aggregateId: row.rider_id,
      payload: {
        commandId: row.id,
        deviceSequence: row.device_sequence,
        commandType: row.command_type,
        reason,
      },
    });
    return { kind: 'rejected', reason };
  }

  /**
   * A device reconnecting with a day of work it could not send.
   *
   * This is the endpoint ADR-0012's wire describes and `enqueue` alone never was: the whole point
   * of an offline queue is that the device pushes *its* commands, and there was no route to do it.
   * A rider finishing a day on a bad connection had nowhere to put 40 scans.
   *
   * Three properties, and each one is load-bearing:
   *
   * 1. **Ordered by the device's `createdAt`, tie-broken by `deviceSequence`.** The device's clock,
   *    not the server's — the server cannot know when the rider pressed the button.
   * 2. **Exactly once, on `(rider_id, device_sequence)`.** The unique index decides; a re-sent batch
   *    comes back `duplicate` per command with the original outcome, never applied twice.
   * 3. **One transaction for the whole batch, with the cap checked up front.** A batch that would
   *    overflow is refused *entirely*, so the device keeps every command and retries later. Filling
   *    the queue with the first 90 and 409ing on the 91st would lose the rest — the exact silent
   *    data loss ADR-0012 exists to prevent.
   */
  async replay(riderId: string, commands: readonly DeviceCommand[]): Promise<ReplayResult> {
    return this.rider.transaction(async (manager) => {
      const rider = await this.riders.findById(manager, riderId);
      if (!rider) {
        throw new ResourceNotFoundError(`Rider ${riderId} not found.`);
      }

      const { count: countStr } = await this.queue.countPending(manager, riderId);
      const queueSize = Number(countStr);
      if (queueSize + commands.length > CAP) {
        throw new CommandQueueFullError(queueSize + commands.length, CAP);
      }

      const ordered = [...commands].sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || a.deviceSequence - b.deviceSequence,
      );

      const results: ReplayOutcome[] = [];
      for (const command of ordered) {
        // The id is ours and known before the insert, so a successful insert needs no read-back.
        const commandId = randomUUID();
        const inserted = await this.queue.enqueue(manager, {
          id: commandId,
          riderId,
          deviceSequence: command.deviceSequence,
          commandType: command.commandType,
          payload: command.payload,
          expectedState: command.expectedState ?? null,
          createdAt: command.createdAt,
        });

        if (!inserted) {
          // Already submitted. Report what happened then rather than re-deciding, so a device that
          // reconnects twice converges on one truth.
          const existing = await this.queue.findByDeviceSequence(
            manager,
            riderId,
            command.deviceSequence,
          );
          results.push({
            deviceSequence: command.deviceSequence,
            commandId: existing?.id ?? '',
            kind: 'duplicate',
            reason: recordedOutcome(existing),
          });
          continue;
        }

        const applied = await this.apply(manager, {
          id: commandId,
          rider_id: riderId,
          device_sequence: command.deviceSequence,
          command_type: command.commandType,
          payload: command.payload,
          expected_state: command.expectedState ?? null,
          created_at: command.createdAt,
        });

        results.push({
          deviceSequence: command.deviceSequence,
          commandId,
          kind: applied.kind,
          reason: applied.kind === 'rejected' ? applied.reason : null,
        });
      }

      // A replayed command is applied inside this same transaction, so nothing is left pending and
      // the queue behind the batch is always empty. `capWarning` therefore reports the BATCH's
      // nearness to the limit — which is the signal a device can act on ("your queue is nearly
      // full, expect a refusal"). Deriving it from `queueSize` would make it dead code on this path.
      return { results, queueSize: 0, capWarning: ordered.length >= CAP_WARNING_THRESHOLD };
    });
  }
}

/** One sentence about a command row's recorded fate, for a duplicate the device has to reconcile. */
function recordedOutcome(
  row: {
    acknowledgedAt?: Date | null;
    rejectedAt?: Date | null;
    rejectionReason?: string | null;
  } | null,
): string {
  if (!row) return 'already submitted';
  if (row.acknowledgedAt) return 'already applied';
  if (row.rejectedAt) return row.rejectionReason ?? 'already rejected';
  return 'already submitted';
}
