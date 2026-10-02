/**
 * The `system` module: outbox, idempotency, consumed events.
 *
 * Owns schema `system`, and is the one deliberate exception to module isolation — every other
 * module writes here, because the outbox is the mechanism that makes isolation possible.
 */

import { Global, Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection';
import { OutboxPublisherService } from './outbox-publisher.service';

@Global()
@Module({
  imports: [forModule('system', [])],
  providers: [OutboxPublisherService],
  exports: [OutboxPublisherService],
})
export class SystemModule {}
