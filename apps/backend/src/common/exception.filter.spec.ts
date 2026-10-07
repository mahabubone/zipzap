import { describe, expect, it } from 'vitest';
import { DomainExceptionFilter, isDependencyFailure } from './exception.filter.ts';

/**
 * The dependency-failure mapping. Reliability matrix row one: Postgres down
 * must answer 503, never 500 — a 500 tells a client the request was wrong;
 * a 503 with Retry-After tells it to come back.
 */

function fakeHost(url = '/v1/shipments') {
  const captured: {
    status?: number;
    body?: Record<string, unknown>;
    headers: Record<string, string>;
  } = {
    headers: {},
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        setHeader: (k: string, v: string) => void (captured.headers[k] = v),
        status: (code: number) => {
          captured.status = code;
          return {
            json: (body: Record<string, unknown>) => void (captured.body = body),
          };
        },
      }),
      getRequest: () => ({ headers: { 'x-request-id': 'req-drill' }, url }),
    }),
  };
  return { host: host as never, captured };
}

describe('isDependencyFailure', () => {
  it('recognises Postgres connection-class SQLSTATEs and node socket codes', () => {
    for (const code of [
      '57P01',
      '57P02',
      '57P03',
      '08000',
      '08003',
      '08006',
      'ECONNREFUSED',
      'ETIMEDOUT',
    ]) {
      expect(isDependencyFailure({ code, message: 'x' }), code).toBe(true);
    }
    expect(isDependencyFailure(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isDependencyFailure(new Error('timeout expired'))).toBe(true);
  });

  it('does not classify business or query errors as dependency failures', () => {
    expect(isDependencyFailure(new Error('duplicate key value violates unique constraint'))).toBe(
      false,
    );
    expect(isDependencyFailure({ code: '23505', message: 'unique violation' })).toBe(false);
    expect(isDependencyFailure(new Error('Cannot move from DRAFT to DELIVERED.'))).toBe(false);
  });
});

describe('DomainExceptionFilter dependency branch', () => {
  it('maps a Postgres outage to 503 with Retry-After, never 500', () => {
    const filter = new DomainExceptionFilter();
    const { host, captured } = fakeHost();
    filter.catch({ code: '57P03', message: 'cannot connect now' }, host);

    expect(captured.status).toBe(503);
    expect(captured.headers['Retry-After']).toBe('5');
    expect(captured.body?.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(captured.body?.request_id).toBe('req-drill');
  });

  it('still maps ordinary failures to 500', () => {
    const filter = new DomainExceptionFilter();
    const { host, captured } = fakeHost();
    filter.catch(new Error('TypeError: undefined is not a function'), host);

    expect(captured.status).toBe(500);
    expect(captured.body?.code).toBe('INTERNAL_ERROR');
  });
});
