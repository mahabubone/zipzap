/**
 * Local provider stand-ins. Dev and CI only — this is never deployed.
 *
 * PayStation and MiMSMS are reproduced from their published documentation. Moneybag is a
 * shape-accurate stand-in with no reachable public reference, and is labelled as such.
 * See infra/fakes/README.md for the full verification table.
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
      control: ['/_calls', '/_script', '/_reset', '/_ipn-log', '/_ipn-config', '/_sms/records'],
      providers: {
        paystation: {
          fidelity: 'contract-verified',
          source: 'https://paystation.com.bd/documentation',
          routes:
            '/paystation/initiate-payment · /paystation/transaction-status · /paystation/v2/transaction-status · /paystation/checkout/:trxId/:token',
        },
        mimsms: {
          fidelity: 'contract-verified',
          source: 'https://apidoc.mimsms.com',
          note: 'Bulk SMS API v2.1. Numbers are 8801XXXXXXXXX with no + and no leading 0.',
          routes:
            '/api/V2/SMS · /api/V2/Send · /api/V2/OneToMany · /api/V2/DSMS · /api/V2/Schedule · /api/V2/DlrApi · /api/V2/BalanceCheck',
        },
        moneybag: {
          fidelity:
            '⚠️ SHAPE-ACCURATE, UNVERIFIED — no public API reference is reachable; field names are ours',
          routes: '/moneybag/v1/charges · /moneybag/checkout/:chargeId',
        },
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
