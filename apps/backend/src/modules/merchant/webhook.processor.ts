/**
 * Webhook queue wiring: registration + the BullMQ processor.
 *
 * One job per attempt, not one job with retries: each attempt writes its own
 * immutable delivery row, and the next delay comes from the ladder (1m → 24h),
 * which is irregular — not BullMQ's fixed/exponential backoff. The processor
 * re-enqueues itself with the computed delay when the outcome is retryable.
 *
 * The queue is registered here (merchant module) and the processor runs in the
 * worker entrypoint via AppModule — same module graph, never duplicated.
 */

import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Job } from 'bullmq';
import type { DataSource } from 'typeorm';
import type { Queue } from 'bullmq';
import { WEBHOOK_QUEUE } from './webhook.consumer.ts';
import type { WebhookJob } from './webhook-sender.service.ts';
import { WebhookRepository } from './webhook.repository.ts';
import { sendAttempt } from './webhook-sender.service.ts';

@Processor(WEBHOOK_QUEUE)
export class WebhookProcessor extends WorkerHost {
  constructor(
    @InjectDataSource('merchant') private readonly merchant: DataSource,
    @Inject(WebhookRepository) private readonly webhooks: WebhookRepository,
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job<WebhookJob & { attempt: number }>): Promise<void> {
    const { attempt, ...base } = job.data;
    const outcome = await sendAttempt(this.merchant, this.webhooks, base, attempt);

    if (!outcome.terminal && outcome.nextDelayMs !== null) {
      await this.queue.add(
        'deliver',
        { ...base, attempt: attempt + 1 },
        { jobId: `${base.deliveryId}-attempt-${attempt + 1}`, delay: outcome.nextDelayMs },
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(): void {
    // Retries are re-enqueued by process(), not by BullMQ: a BullMQ-level failure
    // (processor throw) must be loud, not silently absorbed into the ladder.
  }
}
