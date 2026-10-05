/**
 * Webhook endpoints: create, pause, resume, rotate secret. Thin orchestration.
 *
 * Tenant-scoped by construction: every command carries the merchantId derived from
 * the credential, never from the request body. A client-supplied merchantId is
 * ignored, not trusted.
 *
 * The signing secret is stored RAW in secret_hash for this skeleton so the sender
 * can HMAC with it. `ponytail:` encrypt at rest (KMS/envelope) when a deployment
 * exists; until then the column holds the secret and is never logged or returned
 * after issue/rotate.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { WebhookRepository } from './webhook.repository.ts';
import { WEBHOOK_EVENTS } from './rules/webhook.ts';

const WEBHOOK_WIRE_SET: ReadonlySet<string> = new Set(Object.values(WEBHOOK_EVENTS));

export interface CreateEndpointCommand {
  readonly merchantId: string;
  readonly url: string;
  readonly events: string[];
}

export interface EndpointView {
  readonly id: string;
  readonly merchantId: string;
  readonly url: string;
  readonly events: string[];
  readonly status: 'ACTIVE' | 'PAUSED' | 'FAILING';
  readonly createdAt: string;
}

export function newSigningSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

function toView(entity: {
  id: string;
  merchantId: string;
  url: string;
  events: string[];
  status: 'ACTIVE' | 'PAUSED' | 'FAILING';
  createdAt: Date;
}): EndpointView {
  return {
    id: entity.id,
    merchantId: entity.merchantId,
    url: entity.url,
    events: [...entity.events],
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
  };
}

@Injectable()
export class WebhookEndpointService {
  constructor(
    @InjectDataSource('merchant') private readonly merchant: DataSource,
    @Inject(WebhookRepository) private readonly webhooks: WebhookRepository,
  ) {}

  async create(
    command: CreateEndpointCommand,
  ): Promise<{ endpoint: EndpointView; secret: string }> {
    for (const event of command.events) {
      if (!WEBHOOK_WIRE_SET.has(event)) {
        throw new ResourceNotFoundError(`Unknown webhook event ${event}.`);
      }
    }
    const secret = newSigningSecret();
    const now = new Date();
    const saved = await this.merchant.transaction((manager) =>
      this.webhooks.insertEndpoint(manager, {
        id: randomUUID(),
        merchantId: command.merchantId,
        url: command.url,
        events: [...command.events],
        secretHash: secret,
        status: 'ACTIVE',
        consecutiveFailures: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
        createdAt: now,
        updatedAt: now,
      } as never),
    );
    return { endpoint: toView(saved), secret };
  }

  async rotateSecret(merchantId: string, id: string): Promise<{ secret: string }> {
    const secret = newSigningSecret();
    await this.merchant.transaction(async (manager) => {
      const endpoint = await this.webhooks.findEndpointForUpdate(manager, id);
      if (!endpoint || endpoint.merchantId !== merchantId) {
        throw new ResourceNotFoundError('Webhook endpoint not found.');
      }
      endpoint.secretHash = secret;
      await this.webhooks.saveEndpoint(manager, endpoint);
    });
    return { secret };
  }

  async setStatus(
    merchantId: string,
    id: string,
    status: 'ACTIVE' | 'PAUSED',
  ): Promise<EndpointView> {
    return this.merchant.transaction(async (manager) => {
      const endpoint = await this.webhooks.findEndpointForUpdate(manager, id);
      if (!endpoint || endpoint.merchantId !== merchantId) {
        throw new ResourceNotFoundError('Webhook endpoint not found.');
      }
      endpoint.status = status;
      const saved = await this.webhooks.saveEndpoint(manager, endpoint);
      return toView(saved);
    });
  }

  /** A merchant's own endpoints — bounded, never paginated. Secrets never included. */
  async list(merchantId: string): Promise<EndpointView[]> {
    const rows = await this.merchant.transaction((manager) =>
      this.webhooks.findByMerchant(manager, merchantId),
    );
    return rows.map(toView);
  }
}
