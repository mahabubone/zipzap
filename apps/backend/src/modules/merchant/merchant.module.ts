import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { forModule } from '../../database/module-connection.ts';
import { config } from '../../config.ts';
import { ApiCredentialEntity } from './api-credential.entity.ts';
import { MerchantEntity } from './merchant.entity.ts';
import { FindCredentialService } from './find-credential.service.ts';
import { WebhookEndpointEntity } from './webhook-endpoint.entity.ts';
import { WebhookDeliveryEntity } from './webhook-delivery.entity.ts';
import { WebhookRepository } from './webhook.repository.ts';
import { WebhookEndpointService } from './webhook-endpoint.service.ts';
import { WebhookController } from './webhook.controller.ts';
import { WebhookConsumer, WEBHOOK_QUEUE } from './webhook.consumer.ts';
import { WebhookProcessor } from './webhook.processor.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';

@Module({
  imports: [
    forModule('merchant', [MerchantEntity, ApiCredentialEntity]),
    forModule('merchant', [WebhookEndpointEntity, WebhookDeliveryEntity]),
    IdentityModule,
    // One direction only: webhooks read shipment facts for the merchant fallback.
    // Shipment never imports merchant, so no forwardRef is needed.
    ShipmentModule,
    BullModule.forRootAsync({
      useFactory: () => ({ connection: { url: config().redisUrl } }),
    }),
    BullModule.registerQueue({ name: WEBHOOK_QUEUE }),
  ],
  controllers: [WebhookController],
  providers: [
    FindCredentialService,
    WebhookRepository,
    WebhookEndpointService,
    WebhookConsumer,
    WebhookProcessor,
  ],
  exports: [FindCredentialService],
})
export class MerchantModule {}
