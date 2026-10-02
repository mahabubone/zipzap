/**
 * Control plane.
 *
 * Everything here exists so a test or a demo can drive the fakes without a browser and
 * without waiting on a human. It is namespaced under `/_` so it can never collide with a
 * provider route, and it is the only place state is mutated from outside.
 */

import type { Hono } from 'hono';
import * as ipn from './ipn.ts';
import * as moneybag from './providers/moneybag.ts';
import * as paystation from './providers/paystation.ts';
import * as sms from './providers/sms.ts';
import { allCalls, callsSince, cursor, reset, type ProviderName } from './recorder.ts';
import { resetRules, script, scriptedRules, type Outcome } from './script.ts';

function provider(name: string): ProviderName | undefined {
  return name === 'paystation' || name === 'moneybag' || name === 'sms' ? name : undefined;
}

export function register(app: Hono): void {
  app.get('/_healthz', (c) =>
    c.json({ status: 'ok', providers: ['paystation', 'moneybag', 'sms'] }),
  );

  // --- what we received ------------------------------------------------------------
  // The assertion surface. `?since=<seq>` returns only calls after a cursor, which is how a
  // test avoids being confused by setup traffic.
  app.get('/_calls', (c) => {
    const since = Number(c.req.query('since') ?? '0');
    const name = c.req.query('provider');
    const operation = c.req.query('operation');

    let calls = since > 0 ? callsSince(since) : [...allCalls()];
    if (name) {
      const resolved = provider(name);
      if (!resolved) return c.json({ error: `unknown provider "${name}"` }, 400);
      calls = calls.filter((call) => call.provider === resolved);
    }
    if (operation) calls = calls.filter((call) => call.operation === operation);

    return c.json({ cursor: cursor(), calls });
  });

  app.get('/_cursor', (c) => c.json({ cursor: cursor() }));

  // --- reset ----------------------------------------------------------------------
  // One call returns the whole fakes process to a known state. Without this, tests share
  // state and fail only in a particular order.
  app.post('/_reset', (c) => {
    reset();
    resetRules();
    ipn.reset();
    paystation.reset();
    moneybag.reset();
    sms.reset();
    return c.json({ reset: true, cursor: cursor() });
  });

  // --- fault injection ------------------------------------------------------------
  app.post('/_script', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      provider?: string;
      operation?: string;
      field?: string;
      fieldEquals?: string;
      times?: number;
      outcome?: Outcome;
    };

    const name = body.provider ? provider(body.provider) : undefined;
    if (!name) return c.json({ error: 'provider must be paystation | moneybag | sms' }, 400);
    if (!body.outcome?.kind) return c.json({ error: 'outcome is required' }, 400);

    const rule = script({
      provider: name,
      operation: body.operation,
      field: body.field,
      fieldEquals: body.fieldEquals,
      times: body.times,
      outcome: body.outcome,
    });
    return c.json({
      rule: { id: rule.id, provider: rule.provider, operation: rule.operation, times: rule.times },
    });
  });

  app.get('/_rules', (c) => c.json(scriptedRules()));

  // --- drive a payment to completion, and watch the IPN land -----------------------
  app.post('/_paystation/:invoice/complete', async (c) => {
    const invoice = c.req.param('invoice') ?? '';
    const status = (c.req.query('status') ?? 'success') as
      'success' | 'failed' | 'refund' | 'processing';
    const method = c.req.query('method') ?? 'bKash';
    const transaction = paystation.setStatus(invoice, status, method);
    if (!transaction) return c.json({ error: `unknown invoice "${invoice}"` }, 404);

    // Success triggers an IPN, per their docs. This is where a receiver that does not
    // deduplicate will visibly receive the same body more than once.
    if (status === 'success') {
      const url = transaction.ipnUrl ?? ipn.config().url;
      if (!url)
        return c.json({ error: 'no IPN url configured or supplied on initiate-payment' }, 400);
      const delivery = await ipn.deliver(url, paystation.ipnBody(transaction), transaction.trxId);
      return c.json({ invoice: invoice, trxId: transaction.trxId, ipn: delivery });
    }

    return c.json({ invoice, trxId: transaction.trxId, status });
  });

  app.post('/_paystation/:invoice/refund', (c) => {
    const invoice = c.req.param('invoice') ?? '';
    const transaction = paystation.setStatus(invoice, 'refund', c.req.query('method') ?? 'Visa');
    if (!transaction) return c.json({ error: `unknown invoice "${invoice}"` }, 404);
    return c.json({ invoice, status: transaction.status });
  });

  app.get('/_paystation', (c) => c.json(paystation.allTransactions()));
  app.get('/_moneybag', (c) => c.json(moneybag.allCharges()));
  app.get('/sms-messages', (c) => c.json(sms.allMessages()));

  // --- IPN inspection ---------------------------------------------------------------
  app.get('/_ipn-log', (c) => c.json(ipn.allDeliveries()));

  app.post('/_ipn-config', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      url?: string;
      retryLadderMs?: number[];
    };
    ipn.configure(body.url ?? ipn.config().url, body.retryLadderMs);
    return c.json(ipn.config());
  });
}
