/**
 * Local provider stand-ins. Dev and CI only — this is never deployed.
 *
 * PayStation is reproduced from its published documentation. Moneybag and the SMS provider
 * are shape-accurate only; see infra/fakes/README.md for what is verified and what is not.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import * as control from './control.ts';
import * as moneybag from './providers/moneybag.ts';
import * as paystation from './providers/paystation.ts';
import * as sms from './providers/sms.ts';

const PORT = Number(process.env.FAKES_PORT ?? 4010);

/**
 * Built lazily so tests can import `createApp()` and call it with `app.request(...)`
 * instead of binding a port.
 */
export function createApp(): Hono {
  const app = new Hono();
  const baseUrl = (): string => `http://localhost:${PORT}`;

  control.register(app);
  paystation.register(app, baseUrl);
  moneybag.register(app, baseUrl);
  sms.register(app);

  app.get('/', (c) =>
    c.json({
      service: 'zipzap fakes',
      note: 'Local stand-ins for external providers. No real provider is contacted.',
      control: ['/_calls', '/_script', '/_reset', '/_ipn-log', '/_ipn-config'],
      providers: {
        paystation:
          '/paystation/initiate-payment · /paystation/transaction-status · /paystation/v2/transaction-status · /paystation/checkout/:trxId/:token',
        moneybag:
          '/moneybag/v1/charges · /moneybag/checkout/:chargeId  (shape-accurate, unverified)',
        sms: '/sms/v1/send · /sms/v1/bulk  (shape-accurate, unverified)',
      },
    }),
  );

  return app;
}

export const app = createApp();

/** Started only when run directly, so importing this file in a test binds no port. */
if (process.argv[1]?.endsWith('server.ts')) {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`zipzap fakes listening on http://localhost:${info.port}`);
  });
}
