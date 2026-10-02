/**
 * Moneybag fake.
 *
 * ⚠️ SHAPE-ACCURATE, NOT CONTRACT-VERIFIED.
 *
 * Moneybag's public site links to an API reference that is not reachable without a merchant
 * account (/documentation 404s; the developer docs are not public). The route and field names
 * below are therefore OURS — an independently designed equivalent in the shape every
 * Bangladeshi gateway shares — not a reproduction of Moneybag's documented API.
 *
 * When their reference becomes available, only this file changes. Nothing outside it, because
 * the product talks to `PaymentProvider`, not to Moneybag.
 */

import type { Hono } from 'hono';
import { record, type ProviderName } from '../recorder.ts';
import { take } from '../script.ts';
import * as ipn from '../ipn.ts';

export const PROVIDER: ProviderName = 'moneybag';

export interface Charge {
  chargeId: string;
  orderId: string;
  amountMinor: number;
  status: 'created' | 'paid' | 'failed' | 'refunded';
  paymentMethod: string;
  callbackUrl?: string;
  createdAt: Date;
}

const charges = new Map<string, Charge>();
let counter = 0;

export function reset(): void {
  charges.clear();
  counter = 0;
}

export function allCharges(): readonly Charge[] {
  return [...charges.values()];
}

function nextChargeId(): string {
  counter += 1;
  return `mb_charge_${String(counter).padStart(6, '0')}`;
}

/** Plain object of request headers, so a test can assert what was actually sent. */
function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function major(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

export function register(app: Hono, baseUrl: () => string): void {
  // Create a charge, receive a token to redirect the customer to.
  app.post('/moneybag/v1/charges', async (c) => {
    const rawBody = await c.req.text();
    let body: Record<string, unknown> = {};
    try {
      body = rawBody === '' ? {} : (JSON.parse(rawBody) as Record<string, unknown>);
    } catch {
      body = {};
    }
    record({
      provider: PROVIDER,
      operation: 'create-charge',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body,
      rawBody,
    });

    const scripted = take(PROVIDER, 'create-charge', body);
    if (scripted?.kind === 'httpError') {
      return c.json({ error: 'charge_failed', message: scripted.message }, scripted.status as 400);
    }

    const amountMinor = Number(body.amountMinor ?? 0);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return c.json(
        { error: 'invalid_amount', message: 'amountMinor must be a positive integer.' },
        422,
      );
    }

    const charge: Charge = {
      chargeId: nextChargeId(),
      orderId: String(body.orderId ?? ''),
      amountMinor,
      status: 'created',
      paymentMethod: '',
      callbackUrl: body.callbackUrl === undefined ? undefined : String(body.callbackUrl),
      createdAt: new Date(),
    };
    charges.set(charge.chargeId, charge);

    return c.json(
      {
        chargeId: charge.chargeId,
        orderId: charge.orderId,
        amount: major(amountMinor),
        currency: 'BDT',
        status: charge.status,
        // The hosted page stands in for Moneybag's checkout.
        checkoutUrl: `${baseUrl()}/moneybag/checkout/${charge.chargeId}`,
      },
      201,
    );
  });

  app.get('/moneybag/v1/charges/:chargeId', (c) => {
    const charge = charges.get(c.req.param('chargeId') ?? '');
    if (!charge) return c.json({ error: 'not_found' }, 404);
    return c.json({
      chargeId: charge.chargeId,
      orderId: charge.orderId,
      amount: major(charge.amountMinor),
      status: charge.status,
      paymentMethod: charge.paymentMethod,
      createdAt: charge.createdAt.toISOString(),
    });
  });

  // Browser-facing hosted page, so the demo can be driven by hand.
  app.get('/moneybag/checkout/:chargeId', (c) => {
    const charge = charges.get(c.req.param('chargeId') ?? '');
    if (!charge) return c.text('Unknown charge', 404);
    return c.html(`<!doctype html><html><head><meta charset="utf-8"><title>Moneybag (fake)</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}
.warn{background:#fff4e5;border-left:4px solid #f59e0b;padding:.75rem 1rem}</style></head>
<body><h1>Moneybag fake checkout</h1>
<p class="warn"><strong>Not Moneybag.</strong> Shape-accurate local stand-in; field names are ours. See infra/fakes/README.md.</p>
<p>Charge <code>${charge.chargeId}</code> · order <code>${charge.orderId}</code> · ৳${major(charge.amountMinor)} · <code>${charge.status}</code></p>
<ul>
${['paid', 'failed', 'refunded']
  .map(
    (s) =>
      `<li><a href="/moneybag/checkout/${charge.chargeId}/complete?status=${s}&method=Nagad">${s} via Nagad</a></li>`,
  )
  .join('')}
</ul></body></html>`);
  });

  app.get('/moneybag/checkout/:chargeId/complete', async (c) => {
    const charge = charges.get(c.req.param('chargeId') ?? '');
    if (!charge) return c.text('Unknown charge', 404);

    const requested = c.req.query('status') ?? 'paid';
    const method = c.req.query('method') ?? 'Nagad';
    charge.status = requested === 'paid' ? 'paid' : requested === 'failed' ? 'failed' : 'refunded';
    charge.paymentMethod = method;

    const target = charge.callbackUrl ?? ipn.config().url;
    if (target && charge.status === 'paid') {
      // Fire and forget: the page must not hang on a slow or dead receiver.
      void ipn.deliver(
        target,
        {
          chargeId: charge.chargeId,
          orderId: charge.orderId,
          status: charge.status,
          amount: Number(major(charge.amountMinor)),
          currency: 'BDT',
          paymentMethod: method,
          occurredAt: new Date().toISOString(),
        },
        charge.chargeId,
      );
    }

    return c.text(`charge ${charge.chargeId} is now ${charge.status}`);
  });
}
