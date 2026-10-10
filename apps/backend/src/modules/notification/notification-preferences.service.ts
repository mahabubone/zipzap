/**
 * Read and set one merchant's notification preferences.
 *
 * The whole model in one sentence: a row is an opt-out, and no row means send. Everything else here
 * is bookkeeping around that, and the bookkeeping is deliberately thin — a preferences service that
 * grows a subscription entity, a schedule, a per-recipient override and a template editor is four
 * features wearing one name.
 *
 * The recipient is the *customer*, not the merchant, and this is the honest ceiling of the feature:
 * it records what the merchant wants their customers told, not what each customer consented to.
 * Per-recipient consent is a different table and a different legal question.
 * ponytail: add `notification.recipient_subscriptions` when a regulator asks for per-recipient
 * records. This table then becomes the merchant default it falls back to, which is why it is keyed
 * by merchant and not by the recipient's phone number.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { NotificationRepository } from './notification.repository.ts';
import { TEMPLATE_OF, isEnabled, NOTIFIABLE_EVENTS } from './rules/preferences.ts';

export interface NotificationPreferenceView {
  readonly eventType: string;
  readonly templateName: string;
  readonly enabled: boolean;
  /** True when no row exists, so the screen can say "default" rather than implying a stored choice. */
  readonly isDefault: boolean;
}

export interface SetPreferenceCommand {
  readonly merchantId: string;
  readonly eventType: string;
  readonly enabled: boolean;
}

@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectDataSource('notification') private readonly notificationDataSource: DataSource,
    @Inject(NotificationRepository) private readonly notifications: NotificationRepository,
  ) {}

  /**
   * Every configurable event, answered either way.
   *
   * The full set comes from the rules file, not from the rows, so a merchant sees a toggle for
   * every event that can notify — including the ones they have never touched. A screen that only
   * lists stored rows shows an empty list to everyone who has not opted out of anything, which reads
   * as "there is nothing to configure here".
   */
  async list(merchantId: string): Promise<NotificationPreferenceView[]> {
    return this.notificationDataSource.transaction(async (manager) => {
      const rows = await this.notifications.findPreferences(manager, merchantId);
      return NOTIFIABLE_EVENTS.map((eventType) => {
        const stored = rows.find((row) => row.eventType === eventType);
        return {
          eventType,
          templateName: TEMPLATE_OF[eventType]!,
          enabled: isEnabled(rows, eventType),
          isDefault: stored === undefined,
        };
      });
    });
  }

  /**
   * Set one switch.
   *
   * No idempotency key: the operation is a write of the caller's own current intent to a single
   * cell, and repeating it is repeating the instruction rather than duplicating an effect. A stale
   * `enabled: true` from a retried request is a merchant's own click arriving twice.
   */
  async set(command: SetPreferenceCommand): Promise<NotificationPreferenceView> {
    return this.notificationDataSource.transaction(async (manager) => {
      if (command.enabled) {
        await this.notifications.clearPreference(manager, command.merchantId, command.eventType);
      } else {
        await this.notifications.setPreference(
          manager,
          command.merchantId,
          command.eventType,
          false,
        );
      }
      return {
        eventType: command.eventType,
        templateName: TEMPLATE_OF[command.eventType]!,
        enabled: command.enabled,
        isDefault: command.enabled,
      };
    });
  }
}
