/**
 * Notification repository. Joins the caller's transaction — it must never open its own.
 */

import type { EntityManager } from 'typeorm';
import { Injectable } from '@nestjs/common';
import {
  NotificationDeliveryEntity,
  NotificationMessageEntity,
  NotificationPreferenceEntity,
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

  /**
   * The merchant's opt-out rows, and nothing else.
   *
   * Absent rows are the normal case and mean "send" — see rules/preferences.ts. So this returns
   * the sparse set, never a filled-in default list, and the rule decides what an absence means.
   */
  findPreferences(
    manager: EntityManager,
    merchantId: string,
  ): Promise<NotificationPreferenceEntity[]> {
    return manager.getRepository(NotificationPreferenceEntity).findBy({ merchantId });
  }

  /**
   * `ON CONFLICT DO UPDATE`, because a merchant toggling the same switch twice is the normal case
   * and two rows for one (merchant, event) would make "is it on?" ambiguous.
   */
  async setPreference(
    manager: EntityManager,
    merchantId: string,
    eventType: string,
    enabled: boolean,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO notification.merchant_preferences (merchant_id, event_type, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (merchant_id, event_type) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
      [merchantId, eventType, enabled],
    );
  }

  /**
   * Turning a notification back on forgets the row rather than storing `enabled = true`.
   *
   * A row that says "on" is a row that can be wrong in one direction only: it asserts an action
   * the merchant never took, and the next person to read the table cannot tell it apart from one
   * they did. Absence already means on, so the honest representation of "back to default" is
   * no row at all.
   */
  async clearPreference(
    manager: EntityManager,
    merchantId: string,
    eventType: string,
  ): Promise<void> {
    await manager.query(
      `DELETE FROM notification.merchant_preferences WHERE merchant_id = $1 AND event_type = $2`,
      [merchantId, eventType],
    );
  }
}
