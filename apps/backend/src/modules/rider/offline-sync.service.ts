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

      await this.queue.enqueue(manager, {
        id: randomUUID(),
        riderId,
        deviceSequence,
        commandType,
        payload,
        expectedState: expectedState ?? null,
        createdAt: new Date(),
      });

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
      const validator = this.validators[row.commandType];
      const cmd: PendingCommandRow = {
        id: row.id,
        rider_id: row.riderId,
        device_sequence: row.deviceSequence,
        command_type: row.commandType,
        payload: row.payload as object,
        expected_state: row.expectedState,
        created_at: row.createdAt,
      };
      const result = validator ? await validator(manager, cmd) : { valid: true };

      if (result.valid) {
        await this.queue.markDelivered(manager, commandId);
        await appendOutbox(manager, {
          type: 'RiderCommandDelivered',
          aggregateType: 'rider',
          aggregateId: row.riderId,
          payload: {
            commandId: row.id,
            deviceSequence: row.deviceSequence,
            commandType: row.commandType,
          },
        });
        await claimed.complete(200, {
          outcome: { kind: 'delivered', replayed: false },
          createdAt: row.createdAt,
        });
        return { outcome: { kind: 'delivered', replayed: false }, createdAt: row.createdAt };
      }

      await this.queue.markRejected(manager, commandId, result.reason ?? 'state mismatch');
      await appendOutbox(manager, {
        type: 'RiderCommandRejected',
        aggregateType: 'rider',
        aggregateId: row.riderId,
        payload: {
          commandId: row.id,
          deviceSequence: row.deviceSequence,
          commandType: row.commandType,
          reason: result.reason ?? 'state mismatch',
        },
      });
      const acked: AckResult = {
        outcome: { kind: 'rejected', replayed: false },
        createdAt: row.createdAt,
      };
      await claimed.complete(200, acked);
      return acked;
    });
  }
}
