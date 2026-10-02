/**
 * MiMSMS fake — Bulk SMS API v2.1.
 *
 * CONTRACT-VERIFIED against https://apidoc.mimsms.com, retrieved 2026-10-02.
 * The docs are a Postman collection; endpoint paths, field names, limits and the DLR table
 * below are theirs.
 *
 * Verified from the published spec:
 *   POST   /api/V2/SMS            single send (T) or many (P), JSON body
 *   GET    /api/V2/Send            the same via query string
 *   POST   /api/V2/OneToMany       one message, many recipients — smsData:[{mobNumber}]
 *   POST   /api/V2/DSMS            per-recipient message — smsData:[{mobNumber, message}]
 *   POST   /api/V2/Schedule       scheduled; ISO 8601, 30-minute intervals only
 *   POST   /api/V2/DlrApi          delivery report by trackingId
 *   POST   /api/V2/BalanceCheck    credit balance
 *   GET    /api/IncomingApi/PullSMS  inbound SMS pull
 *
 * Response envelope `{ statusCode, status, trxnId, message, data[] }` is verified — but only
 * from the BalanceCheck documentation, which is the sole endpoint with documented response
 * fields. The *contents* of `data[]` for the send endpoints are INFERRED and marked below.
 *
 * Three details from their spec that change how the product must be written, all reproduced:
 *
 *  1. **Numbers are `8801XXXXXXXXX`** — no `+`, no leading zero. Not E.164. An adapter that
 *     sends `+8801...` is rejected, and the obvious "normalise to E.164" reflex is wrong here.
 *  2. **`transactionType` changes the rules.** "T" allows exactly ONE recipient and ignores
 *     DND; "P" allows up to 1000 and is DND-restricted. A parcel notification is T.
 *  3. **A DLR carries the operator's own retry policy.** Retry policy 3 means the operator
 *     will retry the handset itself, so that failure is not permanent and must not dead-letter.
 */

import type { Hono } from 'hono';
import { record, type ProviderName } from '../recorder.ts';
import { take } from '../script.ts';

export const PROVIDER: ProviderName = 'mimsms';

/** Credentials published in the public Postman collection, for demo use. */
export const DEMO_USERNAME = 'demo@mimsms.com';
export const DEMO_API_KEY = 'J6J68SNLDYG1SVS';
export const DEMO_SENDER_ID = '8809612444598';

const MAX_RECIPIENTS_PROMOTIONAL = 1000;
const MAX_RECIPIENTS_TRANSACTIONAL = 1;

/** "Maximum 1 receiver number is allowed for Transactional SMS (T)." */
const BD_MOBILE_NO_PLUS = /^8801[3-9]\d{8}$/;

const GSM7_LIMIT = 160;
const UNICODE_LIMIT = 70;

/**
 * Operator Delivery Status codes, from the published DLR table.
 *
 * `retryPolicy` is the OPERATOR's own retry count, not ours. It is the reason a delivery
 * failure is not automatically a permanent failure: policy 3 means the carrier will try the
 * handset again, so dead-lettering on first failure would discard a message that was about
 * to succeed.
 */
export const DLR_CODES = [
  { name: 'Delivered', description: 'Delivered in Handset', retryPolicy: 0 },
  {
    name: 'Absent subscriber for SM',
    description: 'Handset off or out of coverage, likely unavailable for 12 hours or more',
    retryPolicy: 3,
  },
  {
    name: 'Undelivered',
    description: 'Handset has no memory capacity to receive the message',
    retryPolicy: 0,
  },
  {
    name: 'Subscriber Busy',
    description: 'MSC busy with an existing transaction to the handset',
    retryPolicy: 3,
  },
  { name: 'Unidentified subscriber', description: 'MT number unknown in the MSC', retryPolicy: 0 },
  {
    name: 'Barred subscriber',
    description: 'Cannot receive SMS: unpaid bills, blacklisted, or user-requested',
    retryPolicy: 0,
  },
  {
    name: 'Illegal subscriber',
    description: 'Sender ID blocked by operators for illegal SMS traffic',
    retryPolicy: 0,
  },
  {
    name: 'SMS Failed',
    description: 'Sender ID blocked by operators for illegal SMS traffic',
    retryPolicy: 0,
  },
  {
    name: 'System failure',
    description: 'Rejection due to SS7 protocol or network failure',
    retryPolicy: 3,
  },
  { name: 'SMS Failed', description: 'Network failure in SMSC link', retryPolicy: 3 },
  { name: 'SMSC Timeout-abort', description: 'SMSC timeout', retryPolicy: 3 },
] as const;

export type DlrName = (typeof DLR_CODES)[number]['name'];

export interface SmsRecord {
  readonly trxnId: string;
  readonly trackingId: string;
  readonly mobileNumber: string;
  readonly message: string;
  readonly senderName: string;
  readonly transactionType: 'T' | 'P';
  readonly segments: number;
  status: 'submitted' | 'delivered' | 'failed';
  dlr?: { name: DlrName; retryPolicy: number };
  readonly createdAt: string;
}

const records: SmsRecord[] = [];
const byTrackingId = new Map<string, SmsRecord>();

let counter = 0;
let campaignCounter = 0;

/**
 * Callers must be IP- and domain-whitelisted, and the API key must be *activated*, before any
 * call is accepted. Modelled as a toggle so a test can prove the adapter surfaces this as an
 * auth failure rather than a silent no-op.
 */
let whitelisted = true;
let keyActivated = true;

export function setAccess(options: { whitelisted?: boolean; keyActivated?: boolean }): void {
  if (options.whitelisted !== undefined) whitelisted = options.whitelisted;
  if (options.keyActivated !== undefined) keyActivated = options.keyActivated;
}

export function access(): { whitelisted: boolean; keyActivated: boolean } {
  return { whitelisted, keyActivated };
}

export function reset(): void {
  records.length = 0;
  byTrackingId.clear();
  counter = 0;
  campaignCounter = 0;
  whitelisted = true;
  keyActivated = true;
}

export function allRecords(): readonly SmsRecord[] {
  return records;
}

/**
 * A message is GSM-7 only if *every* character is 7-bit. One Bangla character makes the whole
 * message UCS-2, halving the per-segment limit from 160 to 70 — under-counting that bills the
 * sender for the wrong number of messages.
 *
 * `ponytail:` real GSM-7 has extension tables for some accented Latin characters, which this
 * does not model. Bangla is not in those tables, so BD traffic is unaffected.
 */
export function countSegments(body: string): number {
  const characters = [...body];
  const isGsm7 = characters.every((character) => character.codePointAt(0)! <= 0x7f);
  return Math.max(1, Math.ceil(characters.length / (isGsm7 ? GSM7_LIMIT : UNICODE_LIMIT)));
}

function nextIds(): { trxnId: string; trackingId: string } {
  counter += 1;
  campaignCounter += 1;
  const stamp = Date.now().toString();
  return {
    trxnId: `TRX${stamp}${String(counter).padStart(6, '0')}`,
    trackingId: `TRX${stamp}${String(counter).padStart(6, '0')}`,
  };
}

export interface Envelope {
  statusCode: string;
  status: string;
  trxnId: string;
  message: string;
  data: unknown[];
}

/** Verified envelope shape. `statusCode` is a STRING, not a number. */
function envelope(
  statusCode: string,
  status: string,
  trxnId: string,
  message: string,
  data: unknown[] = [],
): Envelope {
  return { statusCode, status, trxnId, message, data };
}

function credentials(source: Record<string, unknown>): { apiKey: string; userName: string } {
  return { apiKey: String(source.apiKey ?? ''), userName: String(source.userName ?? '') };
}

/** Their docs do not publish the failure body, so these codes are our inference. */
function failure(trxnId: string, message: string): Envelope {
  return envelope('400', 'Failed', trxnId, message);
}

function guard(creds: { apiKey: string; userName: string }, trxnId: string): Envelope | undefined {
  if (!keyActivated) return failure(trxnId, 'API key is not activated.');
  if (!whitelisted) return failure(trxnId, 'Caller IP or domain is not whitelisted.');
  if (creds.apiKey === '' || creds.userName === '') {
    return failure(trxnId, 'apiKey and userName are required.');
  }
  if (creds.apiKey !== DEMO_API_KEY || creds.userName !== DEMO_USERNAME) {
    return failure(trxnId, 'Invalid apiKey or userName.');
  }
  return undefined;
}

function record2(
  mobileNumber: string,
  message: string,
  senderName: string,
  transactionType: 'T' | 'P',
): SmsRecord {
  const { trxnId, trackingId } = nextIds();
  const record: SmsRecord = {
    trxnId,
    trackingId,
    mobileNumber,
    message,
    senderName,
    transactionType,
    segments: countSegments(message),
    status: 'submitted',
    createdAt: new Date().toISOString(),
  };
  records.push(record);
  byTrackingId.set(trackingId, record);
  return record;
}

/** Comma-separated recipient list, as their spec uses for promotional sends. */
function splitNumbers(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Plain object of request headers, so a test can assert what was actually sent. */
function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function register(app: Hono): void {
  const authorize = (
    operation: string,
    body: Record<string, unknown>,
  ): { trxnId: string; denied?: Envelope } => {
    const trxnId = 'TRX000000000000000000';
    const scripted = take(PROVIDER, operation, body);
    if (scripted?.kind === 'httpError') {
      return {
        trxnId,
        denied: envelope(
          String(scripted.status),
          'Failed',
          trxnId,
          scripted.message ?? 'upstream failure',
        ),
      };
    }
    return { trxnId, denied: guard(credentials(body), trxnId) };
  };

  // --- POST /api/V2/SMS ------------------------------------------------------------
  app.post('/api/V2/SMS', async (c) => {
    const rawBody = await c.req.text();
    const body = parseJson(rawBody);
    record({
      provider: PROVIDER,
      operation: 'send',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body,
      rawBody,
    });

    const { trxnId, denied } = authorize('send', body);
    if (denied) return c.json(denied);

    const transactionType = String(body.transactionType ?? '');
    if (transactionType !== 'T' && transactionType !== 'P') {
      return c.json(failure(trxnId, 'transactionType must be "T" or "P".'));
    }

    const numbers = splitNumbers(String(body.mobileNumber ?? ''));
    const message = String(body.message ?? '');

    // The documented limit differs per type. This is the rule most likely to be missed.
    const limit =
      transactionType === 'T' ? MAX_RECIPIENTS_TRANSACTIONAL : MAX_RECIPIENTS_PROMOTIONAL;
    if (numbers.length === 0) return c.json(failure(trxnId, 'mobileNumber is required.'));
    if (numbers.length > limit) {
      return c.json(
        failure(
          trxnId,
          `transactionType "${transactionType}" allows at most ${limit} recipient(s).`,
        ),
      );
    }

    const invalid = numbers.filter((number) => !BD_MOBILE_NO_PLUS.test(number));
    if (invalid.length > 0) {
      // Their spec shows 8801XXXXXXXXX with no plus sign and no leading zero.
      return c.json(
        failure(
          trxnId,
          `Invalid mobileNumber "${invalid[0]}". Use 8801XXXXXXXXX (no +, no leading 0).`,
        ),
      );
    }
    if (message.trim().length === 0) return c.json(failure(trxnId, 'message is required.'));

    const senderName = String(body.senderName ?? '');
    const created = numbers.map((number) => record2(number, message, senderName, transactionType));

    // `data[]` contents for send responses are INFERRED — only BalanceCheck documents its
    // response fields. The envelope itself is verified.
    return c.json(
      envelope(
        '200',
        'Success',
        created[0]!.trxnId,
        'SMS submitted successfully.',
        created.map((record) => ({
          mobileNumber: record.mobileNumber,
          trackingId: record.trackingId,
          segments: record.segments,
          status: record.status,
        })),
      ),
    );
  });

  // --- GET /api/V2/Send (query-string variant) -------------------------------------
  app.get('/api/V2/Send', async (c) => {
    const query = queryRecord(c.req.url);
    record({
      provider: PROVIDER,
      operation: 'send-get',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body: query,
      rawBody: c.req.url,
    });

    const { trxnId, denied } = authorize('send-get', query);
    if (denied) return c.json(denied);
    return c.json(envelope('200', 'Success', trxnId, 'SMS submitted successfully.'));
  });

  // --- POST /api/V2/OneToMany --------------------------------------------------------
  app.post('/api/V2/OneToMany', async (c) => {
    const rawBody = await c.req.text();
    const body = parseJson(rawBody);
    record({
      provider: PROVIDER,
      operation: 'one-to-many',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body,
      rawBody,
    });

    const { trxnId, denied } = authorize('one-to-many', body);
    if (denied) return c.json(denied);

    const entries = Array.isArray(body.smsData) ? (body.smsData as Record<string, unknown>[]) : [];
    if (entries.length === 0) return c.json(failure(trxnId, 'smsData is required.'));
    if (entries.length > MAX_RECIPIENTS_PROMOTIONAL) {
      return c.json(
        failure(
          trxnId,
          `A maximum of ${MAX_RECIPIENTS_PROMOTIONAL} numbers can be used in a single request.`,
        ),
      );
    }

    const message = String(body.message ?? '');
    const senderName = String(body.senderName ?? '');
    const invalid = entries.filter(
      (entry) => !BD_MOBILE_NO_PLUS.test(String(entry.mobNumber ?? '')),
    );
    if (invalid.length > 0) {
      return c.json(
        failure(trxnId, `Invalid mobNumber "${String(invalid[0]?.mobNumber)}". Use 8801XXXXXXXXX.`),
      );
    }

    const created = entries.map((entry) =>
      record2(String(entry.mobNumber), message, senderName, 'P'),
    );
    return c.json(
      envelope('200', 'Success', created[0]!.trxnId, 'OneToMany submitted successfully.', [
        { count: created.length, trackingIds: created.map((record) => record.trackingId) },
      ]),
    );
  });

  // --- POST /api/V2/DSMS (per-recipient message) -------------------------------------
  app.post('/api/V2/DSMS', async (c) => {
    const rawBody = await c.req.text();
    const body = parseJson(rawBody);
    record({
      provider: PROVIDER,
      operation: 'dsms',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body,
      rawBody,
    });

    const { trxnId, denied } = authorize('dsms', body);
    if (denied) return c.json(denied);

    const entries = Array.isArray(body.smsData) ? (body.smsData as Record<string, unknown>[]) : [];
    if (entries.length === 0) return c.json(failure(trxnId, 'smsData is required.'));
    if (entries.length > MAX_RECIPIENTS_PROMOTIONAL) {
      return c.json(
        failure(
          trxnId,
          `A maximum of ${MAX_RECIPIENTS_PROMOTIONAL} numbers can be used in a single request.`,
        ),
      );
    }

    const senderName = String(body.senderName ?? '');
    // Each recipient gets its own message — the whole point of DSMS.
    const created = entries.map((entry) =>
      record2(String(entry.mobNumber ?? ''), String(entry.message ?? ''), senderName, 'P'),
    );
    return c.json(
      envelope('200', 'Success', created[0]!.trxnId, 'Dynamic SMS submitted successfully.', [
        { count: created.length, trackingIds: created.map((record) => record.trackingId) },
      ]),
    );
  });

  // --- POST /api/V2/Schedule ---------------------------------------------------------
  app.post('/api/V2/Schedule', async (c) => {
    const rawBody = await c.req.text();
    const body = parseJson(rawBody);
    record({
      provider: PROVIDER,
      operation: 'schedule',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body,
      rawBody,
    });

    const { trxnId, denied } = authorize('schedule', body);
    if (denied) return c.json(denied);

    const scheduleTime = String(body.scheduleTime ?? '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(scheduleTime)) {
      return c.json(failure(trxnId, 'scheduleTime must be ISO 8601, e.g. 2026-06-03T15:30:00.'));
    }
    // "Schedule time must be set in 30-minute intervals (e.g. 15:30:00, 16:00:00)."
    const minutes = Number.parseInt(scheduleTime.slice(14, 16), 10);
    const seconds = Number.parseInt(scheduleTime.slice(17, 19), 10);
    if (minutes % 30 !== 0 || seconds !== 0) {
      return c.json(failure(trxnId, 'scheduleTime must be set on a 30-minute interval.'));
    }

    const transactionType = String(body.transactionType ?? 'T') === 'P' ? 'P' : 'T';
    const entries = Array.isArray(body.smsData) ? (body.smsData as Record<string, unknown>[]) : [];
    const shared = String(body.message ?? '');
    const senderName = String(body.senderName ?? '');

    const numbers =
      entries.length > 0
        ? entries.map((entry) => String(entry.mobNumber ?? ''))
        : splitNumbers(String(body.mobNumber ?? ''));

    const limit =
      transactionType === 'T' ? MAX_RECIPIENTS_TRANSACTIONAL : MAX_RECIPIENTS_PROMOTIONAL;
    if (numbers.length === 0) return c.json(failure(trxnId, 'No recipients supplied.'));
    if (numbers.length > limit) {
      return c.json(
        failure(
          trxnId,
          `transactionType "${transactionType}" allows at most ${limit} recipient(s).`,
        ),
      );
    }

    const created = numbers.map((number, index) =>
      record2(
        number,
        entries.length > 0 ? String(entries[index]?.message ?? '') : shared,
        senderName,
        transactionType,
      ),
    );
    return c.json(
      envelope('200', 'Success', created[0]!.trxnId, `Scheduled for ${scheduleTime}.`, [
        {
          scheduleTime,
          count: created.length,
          trackingIds: created.map((record) => record.trackingId),
        },
      ]),
    );
  });

  // --- POST /api/V2/DlrApi -----------------------------------------------------------
  app.post('/api/V2/DlrApi', async (c) => {
    const rawBody = await c.req.text();
    const body = parseJson(rawBody);
    record({
      provider: PROVIDER,
      operation: 'dlr',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body,
      rawBody,
    });

    const { trxnId, denied } = authorize('dlr', body);
    if (denied) return c.json(denied);

    const trackingId = String(body.trackingId ?? '');
    const found = byTrackingId.get(trackingId);
    if (!found) return c.json(failure(trxnId, `No SMS found for trackingId "${trackingId}".`));

    return c.json(
      envelope('200', 'Success', trxnId, 'Delivery report retrieved.', [
        {
          trackingId: found.trackingId,
          mobileNumber: found.mobileNumber,
          segments: found.segments,
          status: found.status,
          // Only populated once a DLR outcome has been applied.
          dlrName: found.dlr?.name ?? null,
          retryPolicy: found.dlr?.retryPolicy ?? null,
        },
      ]),
    );
  });

  // --- POST /api/V2/BalanceCheck ----------------------------------------------------
  // The only endpoint whose response fields are documented, so the envelope here is verified.
  app.post('/api/V2/BalanceCheck', async (c) => {
    const rawBody = await c.req.text();
    const body = parseJson(rawBody);
    record({
      provider: PROVIDER,
      operation: 'balance',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body,
      rawBody,
    });

    const { trxnId, denied } = authorize('balance', body);
    if (denied) return c.json(denied);

    return c.json(
      envelope('200', 'Success', trxnId, 'Balance retrieved successfully.', [
        // `expair_Date` is their spelling. Reproduced: normalising it would break the
        // integration the first time someone reads the real response.
        { balance: '1250.55', expair_Date: '12/31/2026' },
      ]),
    );
  });

  // --- GET /api/IncomingApi/PullSMS ---------------------------------------------------
  app.get('/api/IncomingApi/PullSMS', (c) => {
    const query = queryRecord(c.req.url);
    record({
      provider: PROVIDER,
      operation: 'pull-sms',
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      headers: headerRecord(c.req.raw.headers),
      body: query,
      rawBody: c.req.url,
    });
    return c.json(envelope('200', 'Success', 'TRX000000000000000000', 'No inbound messages.'));
  });

  // --- test control ------------------------------------------------------------------
  // Not part of their API. Lets a test apply a DLR outcome or toggle whitelisting.
  app.post('/_sms/:trackingId/dlr', (c) => {
    const trackingId = c.req.param('trackingId') ?? '';
    const found = byTrackingId.get(trackingId);
    if (!found) return c.json({ error: `unknown trackingId "${trackingId}"` }, 404);

    const name = String(c.req.query('name') ?? 'Delivered') as DlrName;
    const entry = DLR_CODES.find((code) => code.name === name);
    if (!entry)
      return c.json({ error: `unknown DLR "${name}"`, known: DLR_CODES.map((d) => d.name) }, 400);

    found.dlr = { name: entry.name, retryPolicy: entry.retryPolicy };
    found.status = entry.retryPolicy === 0 && entry.name !== 'Delivered' ? 'failed' : 'delivered';
    return c.json(found);
  });

  app.post('/_sms/access-local', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      whitelisted?: boolean;
      keyActivated?: boolean;
    };
    setAccess(body);
    return c.json(access());
  });

  app.get('/_sms/records', (c) => c.json(records));
  app.get('/_sms/dlr-codes', (c) => c.json(DLR_CODES));
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    return raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return {};
  }
}

function queryRecord(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams);
}
