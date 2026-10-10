import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { forModule } from '../../database/module-connection.ts';
import {
  NotificationDeliveryEntity,
  NotificationMessageEntity,
  NotificationPreferenceEntity,
  NotificationTemplateEntity,
} from './notification.entity.ts';
import { NotificationRepository } from './notification.repository.ts';
import { NotificationConsumer, NOTIFICATION_QUEUE } from './notification.consumer.ts';
import { NotificationProcessor } from './notification.processor.ts';
import { SMS_CHANNEL, defaultSmsChannel } from './provider/sms-channel.port.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { NotificationPreferencesService } from './notification-preferences.service.ts';
import { NotificationPreferencesController } from './notification-preferences.controller.ts';

@Module({
  imports: [
    forModule('notification', [
      NotificationTemplateEntity,
      NotificationMessageEntity,
      NotificationDeliveryEntity,
      NotificationPreferenceEntity,
    ]),
    // Shares the global BullMQ root (registered once, in merchant). Re-registering
    // forRoot would create a second connection pool and a second set of workers.
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
    // One direction only: notifications read shipment facts for recipients.
    // Shipment never imports notification, so no forwardRef is needed.
    ShipmentModule,
    // The preferences controller sits behind ApiKeyGuard, which authenticates through identity.
    // Nothing here is the other way round: identity does not import notification.
    IdentityModule,
  ],
  controllers: [NotificationPreferencesController],
  providers: [
    NotificationRepository,
    NotificationPreferencesService,
    NotificationConsumer,
    NotificationProcessor,
    // The SMS port: mock by default, MiMSMS when configured. Environments differ
    // in exactly SMS_PROVIDER — see provider/sms-channel.port.ts.
    { provide: SMS_CHANNEL, useFactory: defaultSmsChannel },
  ],
  exports: [NotificationConsumer],
})
export class NotificationModule {}
