/**
 * Response DTOs for the notification module.
 *
 * Declared as classes with `@ApiProperty` so Swagger emits schemas for openapi.json.
 * See ADR-0004.
 */

import { ApiProperty } from '@nestjs/swagger';

export class NotificationPreferenceDto {
  @ApiProperty({ example: 'ShipmentCreated', description: 'The parcel event this switch governs.' })
  eventType!: string;

  @ApiProperty({
    example: 'shipment.created',
    description: 'The versioned template rendered for this event.',
  })
  templateName!: string;

  @ApiProperty({
    example: true,
    description:
      'Whether this event notifies. Absent means on, so an untouched event reports true.',
  })
  enabled!: boolean;

  @ApiProperty({
    example: false,
    description: 'True when no row is stored; the screen can say "default" rather than a choice.',
  })
  isDefault!: boolean;
}
