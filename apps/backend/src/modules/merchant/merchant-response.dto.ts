/**
 * Response DTOs for the merchant module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';
import type { ApiScope } from '../../common/scopes.ts';

export class CreatedApiKeyDto {
  @ApiProperty({ example: 'key_123456789' })
  keyId!: string;

  @ApiProperty({ example: 'zz_live_abc123...', description: 'Raw secret, shown once at creation' })
  secret!: string;

  @ApiProperty({
    example: ['shipments:read', 'shipments:write'],
    isArray: true,
    description: 'Granted API scopes',
  })
  scopes!: ApiScope[];
}

export class EndpointViewDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id!: string;

  @ApiProperty({ example: 'm-1' })
  merchantId!: string;

  @ApiProperty({ example: 'https://example.com/webhook' })
  url!: string;

  @ApiProperty({
    example: ['shipment.delivered', 'shipment.exception'],
    isArray: true,
  })
  events!: string[];

  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'PAUSED', 'FAILING'] })
  status!: 'ACTIVE' | 'PAUSED' | 'FAILING';

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  createdAt!: string;
}

export class CreatedEndpointDto {
  @ApiProperty({ type: EndpointViewDto })
  endpoint!: EndpointViewDto;

  @ApiProperty({
    example: 'whsec_abc123...',
    description: 'Signing secret, shown once at creation',
  })
  secret!: string;
}

export class RotatedSecretDto {
  @ApiProperty({
    example: 'whsec_new123...',
    description: 'New signing secret, shown once upon rotation',
  })
  secret!: string;
}

export class DeliveryLogRowDto {
  @ApiProperty({ example: 'del-123' })
  id!: string;

  @ApiProperty({ example: 'ep-123' })
  endpointId!: string;

  @ApiProperty({ example: 'shipment.delivered' })
  eventType!: string;

  @ApiProperty({ example: 1 })
  attempt!: number;

  @ApiProperty({ example: 200, nullable: true })
  statusCode!: number | null;

  @ApiProperty({ example: null, nullable: true })
  error!: string | null;

  @ApiProperty({ example: true })
  delivered!: boolean;

  @ApiProperty({ example: true })
  terminal!: boolean;

  @ApiProperty({ example: '2026-10-10T06:00:00.000Z' })
  attemptedAt!: string;
}

export class DeliveryLogPageDto {
  @ApiProperty({ type: DeliveryLogRowDto, isArray: true })
  data!: readonly DeliveryLogRowDto[];

  @ApiProperty({ example: 'cursor_xyz', nullable: true })
  nextCursor!: string | null;
}

export class ReplayedDeliveryDto {
  @ApiProperty({ example: 'del-456' })
  deliveryId!: string;

  @ApiProperty({ example: 'ep-123' })
  endpointId!: string;

  @ApiProperty({ example: 'shipment.delivered' })
  wireEvent!: string;
}
