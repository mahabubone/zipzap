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
