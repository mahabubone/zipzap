import { Global, Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { OutboxPublisherService } from './outbox-publisher.service.ts';

/**
 * The system schema holds the outbox, idempotency keys and consumed events.
 *
 * Every module writes to system.outbox_events. That is the one deliberate exception to module
 * isolation, because the outbox is the mechanism that makes isolation possible.
 */
@Global()
@Module({
  imports: [forModule('system', [])],
  providers: [OutboxPublisherService],
  exports: [OutboxPublisherService],
})
export class SystemModule {}
