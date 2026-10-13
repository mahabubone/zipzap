import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Query for GET /v1/webhooks/deliveries.
 *
 * `limit` carries `@Type(() => Number)` because the global ValidationPipe runs with `transform: true`
 * but WITHOUT `enableImplicitConversion`, so a query string arrives as a string and a bare `@IsInt()`
 * rejects it — the endpoint answered 400 for `?limit=50` and 200 for no limit at all. Every other
 * list endpoint in this codebase declares `limit?: string` and converts in code; this one declared a
 * number, which is why it alone was broken.
 *
 * ponytail: convert in the service like the sibling controllers do and this decorator becomes
 * unnecessary. Kept here because it preserves `@IsInt()` as a real check — "abc" is rejected either
 * way, but so is "1.5" without it.
 */
export class DeliveryLogQuery {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Restrict the log to one endpoint. Omit for every endpoint you own.',
  })
  @IsOptional()
  @IsUUID('4')
  endpointId?: string;

  @ApiProperty({
    example: '3f6d1c2b-9a54-4e77-8b12-0c9de8f1a234',
    description:
      'A `nextCursor` from the previous page — the id of the last row you saw. The next page ' +
      'continues strictly below it, so no row is returned twice and none is skipped as the log grows.',
  })
  @IsOptional()
  @IsUUID('4')
  cursor?: string;

  @ApiProperty({
    example: 50,
    description: 'Page size, 1 to 200. Defaults to 50, and anything larger is clamped to 200.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
