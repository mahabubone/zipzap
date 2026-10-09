/**
 * api-client usability: the generated types plus the handwritten wrapper compose.
 *
 * No HTTP leaves this file — fetch is stubbed. What these prove:
 * request bodies bind to the generated DTO types (a wrong field fails
 * typecheck); the client sends `Authorization: ApiKey` and the required
 * Idempotency-Key; error envelopes throw as ZipZapApiError with code/status;
 * list responses decode into the Page shape.
 */

import { describe, expect, it } from 'vitest';
import { ZipZapApiError, ZipZapClient, type components } from './index.js';

describe('default fetch binding', () => {
  it('survives a browser that rejects an unbound fetch', async () => {
    // A browser `fetch` called with the wrong `this` throws "Illegal
    // invocation" — which is what a bare `fetch` stored on the instance is.
    // Simulated here: the stub throws unless the receiver is globalThis.
    const original = globalThis.fetch;
    let called = false;
    globalThis.fetch = function strictFetch(this: unknown) {
      if (this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      called = true;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ data: [], pagination: { nextCursor: null, hasMore: false } }),
      });
    } as unknown as typeof fetch;

    try {
      const client = new ZipZapClient({ baseUrl: 'http://api.test', apiKey: 'k.s' });
      await client.listShipments();
      expect(called).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});

function stubFetch(
  respond: (
    url: string,
    init: Record<string, unknown>,
  ) => {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  },
): { client: ZipZapClient; seen: Array<{ url: string; init: Record<string, unknown> }> } {
  const seen: Array<{ url: string; init: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: Record<string, unknown>) => {
    seen.push({ url, init });
    const { status, body, headers } = respond(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) => headers?.[name.toLowerCase()] ?? headers?.[name] ?? null,
      },
      json: async () => body,
    };
  }) as unknown as typeof fetch;
  return {
    client: new ZipZapClient({ baseUrl: 'http://api.test', apiKey: 'k.s', fetchImpl }),
    seen,
  };
}

const SHIPMENT_BODY: components['schemas']['CreateShipmentDto'] = {
  senderName: 'Ayesha',
  senderPhone: '+8801700000000',
  senderAddress: 'Dhaka',
  recipientName: 'Rahim',
  recipientPhone: '+8801800000000',
  recipientAddress: 'Chattogram',
  parcelWeightGrams: 1200,
  parcelDescription: 'Two shirts',
  zone: 'dhaka-metro',
  remoteArea: false,
  fragile: false,
};

describe('ZipZapClient', () => {
  it('sends ApiKey auth and the required Idempotency-Key on create', async () => {
    const { client, seen } = stubFetch(() => ({
      status: 201,
      body: { id: 's-1', trackingCode: 'ZP-X', status: 'CREATED' },
    }));
    await client.createShipment(SHIPMENT_BODY, 'key-1');
    expect(seen).toHaveLength(1);
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('ApiKey k.s');
    expect(headers['Idempotency-Key']).toBe('key-1');
    expect(seen[0]!.url).toBe('http://api.test/v1/shipments');
  });

  it('decodes a cursor page into data + nextCursor + hasMore', async () => {
    const { client } = stubFetch(() => ({
      status: 200,
      body: {
        data: [{ id: 's-1' }],
        pagination: { nextCursor: 'abc', hasMore: true },
      },
    }));
    const page = await client.listShipments({ limit: '1' });
    expect(page.data).toHaveLength(1);
    expect(page.nextCursor).toBe('abc');
    expect(page.hasMore).toBe(true);
  });

  it('throws ZipZapApiError with code and status on failure', async () => {
    const { client } = stubFetch(() => ({
      status: 401,
      body: {
        type: 'https://api.zipzap.example/errors/authentication-required',
        title: 'Authentication required',
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        detail: 'AuthenticationRequiredError',
        request_id: 'req-1',
      },
    }));
    const failure = await client.listShipments().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ZipZapApiError);
    expect((failure as ZipZapApiError).code).toBe('AUTHENTICATION_REQUIRED');
    expect((failure as ZipZapApiError).status).toBe(401);
  });

  it('falls back to HTTP_ERROR when the body is not an envelope', async () => {
    const { client } = stubFetch(() => ({ status: 500, body: null }));
    const failure = await client.track('ZP-X').catch((e: unknown) => e);
    expect((failure as ZipZapApiError).code).toBe('HTTP_ERROR');
  });

  it('carries Retry-After from a 429 onto the error', async () => {
    const { client } = stubFetch(() => ({
      status: 429,
      body: {
        type: 'https://api.zipzap.example/errors/rate-limited',
        title: 'Too many requests',
        status: 429,
        code: 'RATE_LIMITED',
        detail: 'Limit exceeded.',
        request_id: 'req-2',
      },
      headers: { 'retry-after': '42' },
    }));
    const failure = await client.track('ZP-X').catch((e: unknown) => e);
    expect((failure as ZipZapApiError).retryAfterSeconds).toBe(42);
  });

  it('decodes a public tracking timeline', async () => {
    const { client, seen } = stubFetch(() => ({
      status: 200,
      body: {
        trackingCode: 'ZP-X',
        status: 'SHIPMENT_CREATED',
        timeline: [
          { sequence: 1, event: 'SHIPMENT_CREATED', occurredAt: '2026-10-07T16:39:47.869Z' },
        ],
      },
    }));
    const tracking = await client.track('ZP-X');
    expect(tracking.timeline).toHaveLength(1);
    expect(tracking.timeline[0]!.event).toBe('SHIPMENT_CREATED');
    // Public: no account, so no Authorization header may be invented for it.
    expect(seen[0]!.url).toBe('http://api.test/track/ZP-X');
  });

  it('quotes a price without an Idempotency-Key, because a quote changes nothing', async () => {
    const { client, seen } = stubFetch(() => ({
      status: 201,
      body: {
        version: 3,
        currency: 'BDT',
        lines: [
          {
            kind: 'BASE',
            label: 'Base delivery fee',
            amount: { amountMinor: 5000, currency: 'BDT' },
          },
        ],
        total: { amountMinor: 5000, currency: 'BDT' },
      },
    }));
    const quote = await client.quote({
      weightGrams: 1000,
      codAmountMinor: 0,
      zone: 'dhaka-metro',
      remoteArea: false,
      fragile: false,
    });
    expect(quote.total.amountMinor).toBe(5000);
    expect(quote.version).toBe(3);
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();
    expect(seen[0]!.url).toBe('http://api.test/v1/pricing/quote');
  });

  it('quotes money as integer minor units, never a decimal', async () => {
    const { client } = stubFetch(() => ({
      status: 201,
      body: {
        version: 1,
        currency: 'BDT',
        lines: [],
        // A float here is the money bug this whole repo is guarded against: the
        // server would 500 on JSON.stringify of a bigint, not silently round.
        total: { amountMinor: 184250075, currency: 'BDT' },
      },
    }));
    const quote = await client.quote({
      weightGrams: 1000,
      codAmountMinor: 500000,
      zone: 'dhaka-metro',
      remoteArea: false,
      fragile: false,
    });
    expect(Number.isInteger(quote.total.amountMinor)).toBe(true);
    expect(quote.total.amountMinor).toBe(184250075);
  });

  it('checks coverage by zone and reports an unserviceable answer honestly', async () => {
    const { client, seen } = stubFetch(() => ({
      status: 200,
      body: {
        zone: 'remote-01',
        serviceable: false,
        reason: 'No delivery point covers this zone yet.',
        estimatedDays: null,
        pickupAvailable: true,
        deliveryAvailable: false,
        codAvailable: false,
      },
    }));
    const coverage = await client.coverage('remote-01');
    // Absence of a coverage row is serviceable: false, never a default-allow.
    expect(coverage.serviceable).toBe(false);
    expect(coverage.reason).toContain('delivery point');
    expect(seen[0]!.url).toBe('http://api.test/v1/coverage?zone=remote-01');
  });

  it('posts each action to its own URL, with the body it declares', async () => {
    // The id is encoded: an action path interpolates a caller-supplied value,
    // and an unencoded '/' or space silently targets a different route.
    const held = stubFetch(() => ({ status: 200, body: { shipmentId: 's-1', status: 'ON_HOLD' } }));
    await held.client.holdShipment('s 1/x', 'waiting on payment');
    expect(held.seen[0]!.url).toBe('http://api.test/v1/shipments/s%201%2Fx/hold');
    expect(held.seen[0]!.init.method).toBe('POST');
    expect(held.seen[0]!.init.body).toBe(JSON.stringify({ reason: 'waiting on payment' }));

    const released = stubFetch(() => ({
      status: 200,
      body: { shipmentId: 's-1', status: 'IN_TRANSIT' },
    }));
    await released.client.releaseShipment('s-1');
    expect(released.seen[0]!.url).toBe('http://api.test/v1/shipments/s-1/release');

    const cancelled = stubFetch(() => ({
      status: 200,
      body: { id: 's-1', trackingCode: 'ZP-X', status: 'CANCELLED' },
    }));
    await cancelled.client.cancelShipment('s-1');
    expect(cancelled.seen[0]!.url).toBe('http://api.test/v1/shipments/s-1/cancel');

    const reported = stubFetch(() => ({
      status: 200,
      body: { shipmentId: 's-1', status: 'DAMAGED' },
    }));
    await reported.client.reportException('s-1', 'DAMAGED', 'crushed corner');
    expect(reported.seen[0]!.url).toBe('http://api.test/v1/shipments/s-1/exception');
    expect(reported.seen[0]!.init.body).toBe(
      JSON.stringify({ reason: 'DAMAGED', note: 'crushed corner' }),
    );
  });

  it('sends merchantId on login only when one was chosen', async () => {
    const withoutBusiness = stubFetch(() => ({
      status: 201,
      body: {
        token: 't',
        expiresAt: 'x',
        tokenType: 'Bearer',
        merchantId: 'm-1',
        merchantIds: ['m-1'],
      },
    }));
    await withoutBusiness.client.login('a@b.test', 'pw');
    expect(withoutBusiness.seen[0]!.init.body).toBe(
      JSON.stringify({ email: 'a@b.test', password: 'pw' }),
    );

    const withBusiness = stubFetch(() => ({
      status: 201,
      body: {
        token: 't',
        expiresAt: 'x',
        tokenType: 'Bearer',
        merchantId: 'm-2',
        merchantIds: ['m-1', 'm-2'],
      },
    }));
    const session = await withBusiness.client.login('a@b.test', 'pw', 'm-2');
    expect(withBusiness.seen[0]!.init.body).toBe(
      JSON.stringify({ email: 'a@b.test', password: 'pw', merchantId: 'm-2' }),
    );
    // The reachable set comes back so a client can offer the choice.
    expect(session.merchantIds).toEqual(['m-1', 'm-2']);
  });

  it('keeps bigint money as a decimal string on live counts', async () => {
    const { client } = stubFetch(() => ({
      status: 200,
      body: {
        timestamp: '2026-10-07T16:40:00.000Z',
        shipments: { total: 11, byStatus: { CREATED: 11 } },
        cod: { total: 2, outstandingAmountMinor: '184250075' },
      },
    }));
    const counts = await client.liveCounts();
    // The controller stringifies; a number here would have thrown server-side.
    expect(counts.cod.outstandingAmountMinor).toBe('184250075');
  });

  it('returns typed shipment detail', async () => {
    const { client, seen } = stubFetch(() => ({
      status: 200,
      body: {
        id: 's-1',
        trackingCode: 'ZP-X',
        status: 'CREATED',
        merchantReference: null,
        senderName: 'Ayesha',
        senderPhone: '+8801700000000',
        recipientName: 'Rahim',
        recipientPhone: '+8801800000000',
        parcelWeightGrams: 1200,
        parcelDescription: 'Two shirts',
        codAmountMinor: 125050,
        codCurrency: 'BDT',
        pricingVersion: 1,
        createdAt: '2026-10-07T16:39:20.017Z',
      },
    }));
    const shipment = await client.getShipment('s-1');
    expect(shipment.recipientName).toBe('Rahim');
    expect(shipment.codAmountMinor).toBe(125050);
    expect(seen[0]!.url).toBe('http://api.test/v1/shipments/s-1');
  });
});
