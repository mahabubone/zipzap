import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

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
  @IsOptional()
  @IsUUID('4')
  endpointId?: string;

  @IsOptional()
  @IsUUID('4')
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
