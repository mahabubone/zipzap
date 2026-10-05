/**
 * SMS sender: the BullMQ processor body, minus the queue.
 *
 * One call = one attempt. Records the immutable delivery row, consults the DLR
 * for the carrier's own retry policy, and decides retry vs terminal. Only the
 * carrier's retry policy 0 dead-letters — our ladder retries on top for when
 * the carrier has exhausted ITS retries.
 *
 * The provider outage path: a send that throws (timeout, refused) is always
 * retried. The transaction that triggered the notification already committed —
 * the message row exists, the job re-fires, nothing is lost.
 */

import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { NotificationRepository } from './notification.repository.ts';
import { delayBeforeAttempt } from '../merchant/rules/webhook.ts';
import { isCarrierTerminal } from './rules/channel.ts';
import type { SmsChannel } from './provider/mimsms.adapter.ts';

export interface SmsJob {
  readonly messageId: string;
  readonly eventId: string;
  readonly recipient: string;
  readonly body: string;
}

export interface SmsAttemptOutcome {
  readonly delivered: boolean;
  readonly terminal: boolean;
  readonly nextDelayMs: number | null;
  readonly carrierPolicy: number | null;
}

export async function sendSmsAttempt(
  notifications: DataSource,
  repository: NotificationRepository,
  channel: SmsChannel,
  job: SmsJob,
  attempt: number,
): Promise<SmsAttemptOutcome> {
  let trackingId: string | null = null;
  let segments: number | null = null;
  let error: string | null = null;

  try {
    const receipt = await channel.send({
      recipientE164: job.recipient,
      body: job.body,
      kind: 'transactional',
    });
    trackingId = receipt.trackingId;
    segments = receipt.segments;
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }

  // The send threw: provider down or unreachable. Always retry — the message
  // row persists and the next attempt re-fires from the queue.
  if (!trackingId) {
    await recordAttempt(notifications, repository, job, attempt, {
      delivered: false,
      terminal: false,
      trackingId: null,
      segments: null,
      dlrName: null,
      carrierPolicy: null,
      error,
    });
    return {
      delivered: false,
      terminal: false,
      nextDelayMs: delayBeforeAttempt(attempt + 1),
      carrierPolicy: null,
    };
  }

  // Sent: consult the DLR. The carrier's policy decides dead-letter, not ours.
  let dlrName: string | null = null;
  let carrierPolicy: number | null = null;
  let delivered = false;
  try {
    const report = await channel.deliveryReport(trackingId);
    dlrName = report.dlrName;
    carrierPolicy = report.retryPolicy;
    delivered = report.delivered;
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }

  // No DLR yet (null): the carrier hasn't reported. Retry — not terminal.
  const terminal =
    delivered || (dlrName !== null && isCarrierTerminal(dlrName as never))
      ? true
      : delayBeforeAttempt(attempt + 1) === null;
  const nextDelayMs = terminal ? null : delayBeforeAttempt(attempt + 1);

  await recordAttempt(notifications, repository, job, attempt, {
    delivered,
    terminal,
    trackingId,
    segments,
    dlrName,
    carrierPolicy,
    error,
  });

  await updateMessageStatus(notifications, job.messageId, delivered);

  return { delivered, terminal, nextDelayMs, carrierPolicy };
}

async function recordAttempt(
  notifications: DataSource,
  repository: NotificationRepository,
  job: SmsJob,
  attempt: number,
  outcome: {
    delivered: boolean;
    terminal: boolean;
    trackingId: string | null;
    segments: number | null;
    dlrName: string | null;
    carrierPolicy: number | null;
    error: string | null;
  },
): Promise<void> {
  await notifications.transaction((manager) =>
    repository.insertDelivery(manager, {
      id: randomUUID(),
      messageId: job.messageId,
      attempt,
      providerRef: null,
      trackingId: outcome.trackingId,
      segments: outcome.segments,
      dlrName: outcome.dlrName,
      carrierPolicy: outcome.carrierPolicy,
      delivered: outcome.delivered,
      terminal: outcome.terminal,
      error: outcome.error,
      attemptedAt: new Date(),
    } as never),
  );
}

async function updateMessageStatus(
  notifications: DataSource,
  messageId: string,
  delivered: boolean,
): Promise<void> {
  // Status moves forward only: QUEUED -> SENT, or -> FAILED / DEAD_LETTERED at terminal.
  // The deliveries log is the audit trail; the message row is the current state.
  await notifications.transaction(async (manager) => {
    const rows = await manager.query(
      `SELECT id, status FROM notification.messages WHERE id = $1 FOR UPDATE`,
      [messageId],
    );
    const row = rows[0] as { id: string; status: string } | undefined;
    if (!row || row.status !== 'QUEUED') return;
    // QUEUED persists across retries; only SENT sticks. Terminal failure states
    // land on the deliveries log (DEAD_LETTERED there); the message row stays
    // QUEUED so a replay can still pick it up. The audit trail, not this flag,
    // is what answers "what happened".
    if (delivered) {
      await manager.query(`UPDATE notification.messages SET status = 'SENT' WHERE id = $1`, [
        messageId,
      ]);
    }
  });
}
