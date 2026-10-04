/**
 * Webhook repository. Joins the caller's transaction — it must never open its own.
 *
 * Endpoints are mutable config (pause, rotate, fail-count); deliveries are immutable
 * evidence (insert only — the trigger rejects anything else).
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { WebhookEndpointEntity } from './webhook-endpoint.entity.ts';
import { WebhookDeliveryEntity } from './webhook-delivery.entity.ts';

@Injectable()
export class WebhookRepository {
  insertEndpoint(
    manager: EntityManager,
    entity: WebhookEndpointEntity,
  ): Promise<WebhookEndpointEntity> {
    return manager.getRepository(WebhookEndpointEntity).save(entity);
  }

  findEndpoint(manager: EntityManager, id: string): Promise<WebhookEndpointEntity | null> {
    return manager.getRepository(WebhookEndpointEntity).findOneBy({ id });
  }

  async findEndpointForUpdate(
    manager: EntityManager,
    id: string,
  ): Promise<WebhookEndpointEntity | null> {
    return manager
      .createQueryBuilder(WebhookEndpointEntity, 'e')
      .setLock('pessimistic_write')
      .where('e.id = :id', { id })
      .getOne();
  }

  findActiveForEvent(
    manager: EntityManager,
    merchantId: string,
    wireEvent: string,
  ): Promise<WebhookEndpointEntity[]> {
    return manager
      .createQueryBuilder(WebhookEndpointEntity, 'e')
      .where('e.merchantId = :merchantId', { merchantId })
      .andWhere('e.status IN (:...statuses)', { statuses: ['ACTIVE', 'FAILING'] })
      .andWhere(':event = ANY (e.events)', { event: wireEvent })
      .getMany();
  }

  saveEndpoint(
    manager: EntityManager,
    entity: WebhookEndpointEntity,
  ): Promise<WebhookEndpointEntity> {
    return manager.getRepository(WebhookEndpointEntity).save(entity);
  }

  insertDelivery(
    manager: EntityManager,
    entity: WebhookDeliveryEntity,
  ): Promise<WebhookDeliveryEntity> {
    return manager.getRepository(WebhookDeliveryEntity).save(entity);
  }
}
