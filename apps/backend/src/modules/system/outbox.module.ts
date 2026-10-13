import { Global, Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { OutboxPublisherService } from './outbox-publisher.service.ts';
import { AuditService } from './audit.service.ts';

/**
 * The system schema holds the outbox, idempotency keys, consumed events and the audit trail.
 *
 * Every module writes to system.outbox_events. That is the one deliberate exception to module
 * isolation, because the outbox is the mechanism that makes isolation possible.
 *
 * `system.audit_events` is the same deal for the same reason: an audit row is written by identity,
 * merchant, shipment and support alike. Putting it in `identity` would make every module call
 * identity to report what it did.
 */
@Global()
@Module({
  imports: [forModule('system', [])],
  providers: [OutboxPublisherService, AuditService],
  exports: [OutboxPublisherService, AuditService],
})
export class SystemModule {}
