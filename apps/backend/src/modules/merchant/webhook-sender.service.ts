/**
 * Webhook sender: the BullMQ processor body, minus the queue.
 *
 * One call = one attempt. The processor (wired in the worker entrypoint) calls
 * this per job, records the immutable delivery row, and decides retry vs terminal
 * from the outcome plus rules/isRetryable. The ladder delays live in the queue
 * options (backoff per attempt); this function only reports what happened.
 *
 * Timeouts and connection failures surface as statusCode null — always retried.
 * A 4xx (other than 429) is terminal immediately: the payload will not become
 * valid, and retrying it is a DoS tool against our own infrastructure.
 */

import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { WebhookRepository } from './webhook.repository.ts';
import { delayBeforeAttempt, isRetryable, signPayload } from './rules/webhook.ts';

export interface WebhookJob {
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly merchantId: string;
  readonly url: string;
  readonly secret: string;
  readonly wireEvent: string;
  readonly payload: Record<string, unknown>;
}

export interface AttemptOutcome {
  readonly delivered: boolean;
  readonly terminal: boolean;
  readonly statusCode: number | null;
  readonly nextDelayMs: number | null;
}

export async function sendAttempt(
  merchant: DataSource,
  repository: WebhookRepository,
  job: WebhookJob,
  attempt: number,
  fetcher: typeof fetch = fetch,
): Promise<AttemptOutcome> {
  const rawBody = JSON.stringify(job.payload);
  const timestampSeconds = Math.trunc(Date.now() / 1000);
  const signature = signPayload(job.secret, timestampSeconds, rawBody);

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;
  try {
    const response = await fetcher(job.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ZipZap-Signature': `t=${timestampSeconds},v1=${signature}`,
        'ZipZap-Delivery': job.deliveryId,
        'ZipZap-Event': job.wireEvent,
        'ZipZap-Attempt': String(attempt),
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    statusCode = response.status;
    responseBody = (await response.text()).slice(0, 4_000);
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }

  const delivered = statusCode !== null && statusCode >= 200 && statusCode < 300;
  const retryable = !delivered && isRetryable(statusCode);
  const nextDelayMs = retryable ? delayBeforeAttempt(attempt + 1) : null;
  const terminal = delivered || nextDelayMs === null;

  await merchant.transaction((manager) =>
    repository.insertDelivery(manager, {
      id: randomUUID(),
      endpointId: job.endpointId,
      merchantId: job.merchantId,
      eventType: job.wireEvent,
      payload: job.payload,
      attempt,
      statusCode,
      responseBody,
      error,
      delivered,
      terminal,
      attemptedAt: new Date(),
    } as never),
  );

  return { delivered, terminal, statusCode, nextDelayMs };
}
