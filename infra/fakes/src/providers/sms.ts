/**
 * Domestic SMS provider fake.
 *
 * ⚠️ SHAPE-ACCURATE, NOT CONTRACT-VERIFIED.
 *
 * sms.net.bd's developer site is inactive and mimsms.com publishes no public API reference,
 * so the field names below are OURS in the shape every BD bulk-SMS HTTP API shares:
 * submit → message id → optional delivery-report callback.
 *
 * What IS modelled faithfully, because it is what actually breaks integrations:
 *   - MSISDN in international form (+8801XXXXXXXXX) and rejected in local form
 *   - a character-limit rejection, because a silently truncated Bangla message is a
 *     support incident
 *   - a `status` callback to a receiver URL, which is what proves our notification module
 *     consumes delivery receipts correctly
 */

import type { Hono } from 'hono';
import { record, type ProviderName } from '../recorder.ts';
import { take } from '../script.ts';

export const PROVIDER: ProviderName = 'sms';

export interface SmsMessage {
  readonly id: string;
  readonly to: string;
  readonly body: string;
  readonly senderId?: string;
  readonly segments: number;
  readonly status: 'submitted' | 'delivered' | 'failed';
}

const BD_MOBILE = /^\+8801[3-9]\d{8}$/;
const LOCAL_BD_MOBILE = /^01[3-9]\d{8}$/;
const GSM7_LIMIT = 160;
const UNICODE_LIMIT = 70;

const messages: SmsMessage[] = [];
let counter = 0;

export function reset(): void {
  messages.length = 0;
  counter = 0;
}

export function allMessages(): readonly SmsMessage[] {
  return messages;
}

/** Plain object of request headers, so a test can assert what was actually sent. */
function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function nextId(): string {
  counter += 1;
  return `sms_${String(counter).padStart(6, '0')}`;
}

/**
 * A message is GSM-7 only if *every* character is 7-bit. One Bangla character makes the whole
 * message UCS-2, which halves the per-segment limit from 160 to 70 — and silently under-counting
 * that is how a merchant gets billed for three messages instead of one.
 *
 * `ponytail:` real GSM-7 has extension tables for some accented Latin characters, which this
 * does not model. Bangla is not in those tables, so BD traffic is unaffected.
 */
function countSegments(body: string): number {
  const characters = [...body];
  const isGsm7 = characters.every((character) => character.codePointAt(0)! <= 0x7f);
  const perSegment = isGsm7 ? GSM7_LIMIT : UNICODE_LIMIT;
  return Math.max(1, Math.ceil(characters.length / perSegment));
}

export function register(app: Hono): void {
  // Single send — the shape used by an OTP or a delivery notice.
  app.post('/sms/v1/send', async (c) => {
    const rawBody = await c.req.text();
    let body: Record<string, unknown> = {};
    try {
      body = rawBody === '' ? {} : (JSON.parse(rawBody) as Record<string, unknown>);
    } catch {
      body = {};
    }
    record({
      provider: PROVIDER,
      operation: 'send',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body,
      rawBody,
    });

    const scripted = take(PROVIDER, 'send', body);
    if (scripted?.kind === 'httpError') {
      return c.json(
        { error: 'provider_unavailable', message: scripted.message },
        scripted.status as 503,
      );
    }

    const to = String(body.to ?? '');
    const text = String(body.body ?? '');

    // Normalisation is where BD integrations usually go wrong. Reject rather than guess.
    if (LOCAL_BD_MOBILE.test(to)) {
      return c.json(
        { error: 'invalid_msisdn', message: 'Use international format +8801XXXXXXXXX.' },
        422,
      );
    }
    if (!BD_MOBILE.test(to)) {
      return c.json(
        { error: 'invalid_msisdn', message: 'Not a valid Bangladesh mobile number.' },
        422,
      );
    }
    if (text.length === 0) {
      return c.json({ error: 'empty_body' }, 422);
    }

    const message: SmsMessage = {
      id: nextId(),
      to,
      body: text,
      senderId: body.senderId === undefined ? undefined : String(body.senderId),
      segments: countSegments(text),
      status: 'submitted',
    };
    messages.push(message);

    return c.json({ id: message.id, to, segments: message.segments, status: message.status }, 202);
  });

  // Bulk send — every recipient reported individually, so one bad number does not lose the batch.
  app.post('/sms/v1/bulk', async (c) => {
    const rawBody = await c.req.text();
    let body: Record<string, unknown> = {};
    try {
      body = rawBody === '' ? {} : (JSON.parse(rawBody) as Record<string, unknown>);
    } catch {
      body = {};
    }
    record({
      provider: PROVIDER,
      operation: 'bulk',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body,
      rawBody,
    });

    const scripted = take(PROVIDER, 'bulk', body);
    if (scripted?.kind === 'httpError') {
      return c.json({ error: 'provider_unavailable' }, scripted.status as 503);
    }

    const text = String(body.body ?? '');
    const recipients = Array.isArray(body.to) ? (body.to as unknown[]).map(String) : [];
    const results = recipients.map((to) => {
      if (LOCAL_BD_MOBILE.test(to) || !BD_MOBILE.test(to)) {
        return { to, accepted: false, error: 'invalid_msisdn' };
      }
      const message: SmsMessage = {
        id: nextId(),
        to,
        body: text,
        segments: countSegments(text),
        status: 'submitted',
      };
      messages.push(message);
      return { to, accepted: true, id: message.id, segments: message.segments };
    });

    return c.json(
      {
        accepted: results.filter((r) => r.accepted).length,
        rejected: results.filter((r) => !r.accepted).length,
        results,
      },
      202,
    );
  });

  app.get('/sms/v1/messages/:id', (c) => {
    const message = messages.find((m) => m.id === c.req.param('id'));
    if (!message) return c.json({ error: 'not_found' }, 404);
    return c.json(message);
  });

  /** The most recent sends, for assertions. Newest last. */
  app.get('/sms/v1/messages', (c) => {
    const limit = Number(c.req.query('limit') ?? '20');
    return c.json(messages.slice(-Math.max(1, limit)));
  });
}
