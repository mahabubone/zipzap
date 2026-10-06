/**
 * SMS queue wiring: the BullMQ processor.
 *
 * One job per attempt, mirroring the webhook shape: each attempt writes its own
 * immutable delivery row, and the next delay comes from the ladder. The sender
 * consults the DLR — only the carrier's retry policy 0 dead-letters.
 */

import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Job, Queue } from 'bullmq';
import type { DataSource } from 'typeorm';
import { NOTIFICATION_QUEUE } from './notification.consumer.ts';
import { jobFailureTotal } from '../../common/metrics';
import type { SmsJob } from './notification-sender.service.ts';
import { sendSmsAttempt } from './notification-sender.service.ts';
import { NotificationRepository } from './notification.repository.ts';
import { SMS_CHANNEL } from './provider/sms-channel.port.ts';
import type { SmsChannel } from './provider/mimsms.adapter.ts';

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor extends WorkerHost {
  constructor(
    @InjectDataSource('notification') private readonly notifications: DataSource,
    @Inject(NotificationRepository) private readonly repository: NotificationRepository,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    @Inject(SMS_CHANNEL) private readonly sms: SmsChannel,
  ) {
    super();
  }

  async process(job: Job<SmsJob & { attempt: number }>): Promise<void> {
    const { attempt, ...base } = job.data;
    const outcome = await sendSmsAttempt(
      this.notifications,
      this.repository,
      this.sms,
      base,
      attempt,
    );

    if (!outcome.terminal && outcome.nextDelayMs !== null) {
      await this.queue.add(
        'send',
        { ...base, attempt: attempt + 1 },
        { jobId: `${base.messageId}-attempt-${attempt + 1}`, delay: outcome.nextDelayMs },
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job): void {
    // BullMQ emits (job, error, prev) positionally — Nest binds the raw listener.
    jobFailureTotal.labels({ queue: job.queueName }).inc();
  }
}
