/**
 * The error envelope every failure is mapped into — the §87 shape.
 *
 * Declared as a schema so a generated client can type its own error handling instead of
 * hand-declaring a shape from a live response, which is what it did while responses had no
 * schemas. `toEnvelope` in `error-envelope.ts` is the only writer of this shape; nothing
 * constructs one by hand, and this DTO is the type mirror of that function rather than a
 * second definition.
 */

import { ApiProperty } from '@nestjs/swagger';
import { MoneyMinorString } from './money.ts';

export class ErrorEnvelopeDto {
  @ApiProperty({
    example: 'https://api.zipzap.example/errors/permission-denied',
    description:
      'RFC 9457 problem type. A stable URI derived from `code`, so the same failure always has the same type.',
  })
  type!: string;

  @ApiProperty({ example: 'Forbidden', description: 'Short, human-readable summary of the class.' })
  title!: string;

  @ApiProperty({ example: 403, description: 'HTTP status, repeated from the response.' })
  status!: number;

  @ApiProperty({
    example: 'PERMISSION_DENIED',
    description:
      'Stable machine-readable code. Clients switch on this, never on `title` or `detail`. Both change with wording.',
  })
  code!: string;

  @ApiProperty({
    example: 'Missing scope shipments:write.',
    description: 'Human-readable detail. Safe to show an end user; never contains a secret.',
  })
  detail!: string;

  @ApiProperty({
    example: 'req-01J8Z9K3QW4V5N6M7P8R9S0T1U',
    description: 'Request correlation id. Quote this when reporting a failure.',
  })
  request_id!: string;
}

/**
 * The envelope of a partially applied bulk write.
 *
 * Money uses the string form: these are aggregates, and a batch's rejected total can exceed what a
 * JSON number represents exactly.
 */
export class BulkRowErrorDto {
  @ApiProperty({ example: 12, description: '1-based line number in the uploaded file.' })
  line!: number;

  @ApiProperty({ example: 'VALIDATION_FAILED' })
  code!: string;

  @ApiProperty({ example: 'Recipient phone must be 8801XXXXXXXXX.' })
  message!: string;
}

export class BulkRejectionDto {
  @ApiProperty({ example: 980, description: 'Rows that were accepted and enqueued.' })
  accepted!: number;

  @ApiProperty({ type: BulkRowErrorDto, isArray: true, description: 'Rows that were rejected.' })
  rejected!: readonly BulkRowErrorDto[];

  @ApiProperty({
    example: '1250500',
    description: 'Money carried by the rejected rows, in poisha.',
  })
  rejectedMinor?: string;
}

/** Re-export so DTO files can import all their shared property decorators from one place. */
export { MoneyMinorString };
