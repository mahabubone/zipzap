import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Redis } from 'ioredis';
import { forModule } from '../../database/module-connection.ts';
import { config } from '../../config.ts';
import { ApiCredentialEntity } from './api-credential.entity.ts';
import { MerchantEntity } from './merchant.entity.ts';
import { FindCredentialService } from './find-credential.service.ts';
import { WebhookEndpointEntity } from './webhook-endpoint.entity.ts';
import { WebhookDeliveryEntity } from './webhook-delivery.entity.ts';
import { WebhookRepository } from './webhook.repository.ts';
import { WebhookEndpointService } from './webhook-endpoint.service.ts';
import { WebhookReplayService } from './webhook-replay.service.ts';
import { WebhookController } from './webhook.controller.ts';
import { WebhookConsumer, WEBHOOK_QUEUE } from './webhook.consumer.ts';
import { WebhookProcessor } from './webhook.processor.ts';
import { IdentityModule } from '../identity/identity.module.ts';

@Module({
  imports: [
    forModule('merchant', [
      MerchantEntity,
      ApiCredentialEntity,
      WebhookEndpointEntity,
      WebhookDeliveryEntity,
    ]),
    // Cycle is inherent, not introduced here: identity imports merchant for
    // credential verification, and the webhook controller needs the guards.
    // forwardRef on this edge, matching the shipment<->tracking precedent.
    forwardRef(() => IdentityModule),
    BullModule.forRootAsync({
      // Native ESM: BullMQ cannot load ioredis itself, so pass a constructed
      // client instead of connection options. maxRetriesPerRequest must be null
      // for BullMQ's blocking connections — the default (20) breaks them.
      useFactory: () => ({
        connection: new Redis(config().redisUrl, { maxRetriesPerRequest: null }),
      }),
    }),
    BullModule.registerQueue({ name: WEBHOOK_QUEUE }),
  ],
  controllers: [WebhookController],
  providers: [
    FindCredentialService,
    WebhookRepository,
    WebhookEndpointService,
    WebhookReplayService,
    WebhookConsumer,
    WebhookProcessor,
  ],
  exports: [FindCredentialService],
})
export class MerchantModule {}
