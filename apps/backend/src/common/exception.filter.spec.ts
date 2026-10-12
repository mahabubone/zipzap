import { describe, expect, it } from 'vitest';
import { DomainExceptionFilter, isDependencyFailure } from './exception.filter.ts';
import { AuthenticationRequiredError, InvalidTransitionError } from './domain-error.ts';

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

/**
 * What a class name does not look like in a response body.
 *
 * `DomainError`'s constructor defaults `message` to the class name, so a bare
 * `throw new AuthenticationRequiredError()` produced `detail: "AuthenticationRequiredError"` —
 * which reached the console UI as `AUTHENTICATION_REQUIRED: AuthenticationRequiredError` and was
 * visible in the error-state screenshots. Found by looking at the image, not by a test: the
 * mapping was correct against the spec and still wrong for a person.
 */
describe('DomainExceptionFilter detail is written for a reader', () => {
  it('replaces a bare class-name message with the spec title', () => {
    const filter = new DomainExceptionFilter();
    const { host, captured } = fakeHost();
    filter.catch(new AuthenticationRequiredError(), host);

    expect(captured.status).toBe(401);
    expect(captured.body?.code).toBe('AUTHENTICATION_REQUIRED');
    expect(captured.body?.detail).toBe('Authentication required');
    // The regression itself: a constructor name must never reach the wire.
    expect(String(captured.body?.detail)).not.toContain('AuthenticationRequiredError');
  });

  it('passes a written message through untouched — the detail is what makes it actionable', () => {
    const filter = new DomainExceptionFilter();
    const { host, captured } = fakeHost();
    filter.catch(new InvalidTransitionError('DELIVERED', 'PICKED_UP'), host);

    expect(captured.body?.detail).toContain('DELIVERED');
    expect(captured.body?.detail).toContain('PICKED_UP');
  });

  it('keeps the machine code intact regardless of what the message says', () => {
    // The client branches on `code`, never on `detail` — so the humanising must not touch it.
    const filter = new DomainExceptionFilter();
    const { host, captured } = fakeHost();
    filter.catch(new AuthenticationRequiredError(), host);

    expect(captured.body?.code).toBe('AUTHENTICATION_REQUIRED');
    expect(captured.body?.request_id).toBe('req-drill');
  });
});
