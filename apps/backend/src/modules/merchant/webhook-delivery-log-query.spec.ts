import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { DeliveryLogQuery } from './webhook-delivery-log-query.dto.ts';

/**
 * The delivery log used to 400 on `?limit=50`.
 *
 * Every other list endpoint in the codebase declares `limit?: string` and converts it in code.
 * This one declared `limit?: number` behind `@IsInt()`, which looks correct and is not: the global
 * ValidationPipe runs with `transform: true` but without `enableImplicitConversion`, so a query
 * string stays a string and `@IsInt()` rejects it. The endpoint answered 400 with no limit and 400
 * with one — a screen that always showed an empty log, and an empty log that reads exactly like
 * "nothing has ever been delivered".
 *
 * Caught by `scripts/verify-webhook-portal.mjs`, which asked for the log the way a merchant does.
 *
 * The DTO lives in its own file so this test can import it without dragging Nest's DI container
 * in through the controller.
 */
describe('DeliveryLogQuery', () => {
  const parse = (query: Record<string, string>) =>
    validate(plainToInstance(DeliveryLogQuery, query));

  it('accepts a numeric limit from the query string and converts it', async () => {
    const dto = plainToInstance(DeliveryLogQuery, { limit: '50' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.limit).toBe(50);
    expect(typeof dto.limit).toBe('number');
  });

  it('still rejects a limit that is not a number', async () => {
    const errors = await parse({ limit: 'abc' });
    expect(errors.map((e) => e.property)).toContain('limit');
  });

  it('rejects a limit below the minimum', async () => {
    const errors = await parse({ limit: '0' });
    expect(errors.map((e) => e.property)).toContain('limit');
  });

  it('accepts a UUID endpoint filter', async () => {
    const errors = await parse({ endpointId: 'cd5abbfb-1850-42b1-be17-36b463fbe5c7' });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-UUID endpoint filter rather than ignoring it', async () => {
    const errors = await parse({ endpointId: 'not-a-uuid' });
    expect(errors.map((e) => e.property)).toContain('endpointId');
  });

  it('accepts no parameters at all', async () => {
    expect(await parse({})).toHaveLength(0);
  });
});
