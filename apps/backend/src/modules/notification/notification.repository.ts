/**
 * Notification repository. Joins the caller's transaction — it must never open its own.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import {
  NotificationDeliveryEntity,
  NotificationMessageEntity,
  NotificationTemplateEntity,
} from './notification.entity.ts';

@Injectable()
export class NotificationRepository {
  insertMessage(
    manager: EntityManager,
    entity: NotificationMessageEntity,
  ): Promise<NotificationMessageEntity> {
    return manager.getRepository(NotificationMessageEntity).save(entity);
  }

  findMessageByDedupe(
    manager: EntityManager,
    eventId: string,
    channel: string,
    recipient: string,
  ): Promise<NotificationMessageEntity | null> {
    return manager
      .getRepository(NotificationMessageEntity)
      .findOneBy({ eventId, channel: channel as 'sms', recipient });
  }

  saveMessage(
    manager: EntityManager,
    entity: NotificationMessageEntity,
  ): Promise<NotificationMessageEntity> {
    return manager.getRepository(NotificationMessageEntity).save(entity);
  }

  findTemplate(manager: EntityManager, name: string): Promise<NotificationTemplateEntity | null> {
    return manager
      .createQueryBuilder(NotificationTemplateEntity, 't')
      .where('t.name = :name', { name })
      .orderBy('t.version', 'DESC')
      .getOne();
  }

  insertTemplate(
    manager: EntityManager,
    entity: NotificationTemplateEntity,
  ): Promise<NotificationTemplateEntity> {
    return manager.getRepository(NotificationTemplateEntity).save(entity);
  }

  insertDelivery(
    manager: EntityManager,
    entity: NotificationDeliveryEntity,
  ): Promise<NotificationDeliveryEntity> {
    return manager.getRepository(NotificationDeliveryEntity).save(entity);
  }
}
