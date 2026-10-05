import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { forModule } from '../../database/module-connection.ts';
import {
  NotificationDeliveryEntity,
  NotificationMessageEntity,
  NotificationTemplateEntity,
} from './notification.entity.ts';
import { NotificationRepository } from './notification.repository.ts';
import { NotificationConsumer, NOTIFICATION_QUEUE } from './notification.consumer.ts';
import { NotificationProcessor } from './notification.processor.ts';
import { SMS_CHANNEL, defaultSmsChannel } from './provider/sms-channel.port.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';

@Module({
  imports: [
    forModule('notification', [
      NotificationTemplateEntity,
      NotificationMessageEntity,
      NotificationDeliveryEntity,
    ]),
    // Shares the global BullMQ root (registered once, in merchant). Re-registering
    // forRoot would create a second connection pool and a second set of workers.
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
    // One direction only: notifications read shipment facts for recipients.
    // Shipment never imports notification, so no forwardRef is needed.
    ShipmentModule,
  ],
  providers: [
    NotificationRepository,
    NotificationConsumer,
    NotificationProcessor,
    // The SMS port: mock by default, MiMSMS when configured. Environments differ
    // in exactly SMS_PROVIDER — see provider/sms-channel.port.ts.
    { provide: SMS_CHANNEL, useFactory: defaultSmsChannel },
  ],
  exports: [NotificationConsumer],
})
export class NotificationModule {}
