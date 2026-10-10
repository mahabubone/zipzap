/**
 * @zipzap/api-client — typed HTTP client for the ZipZap v1 API.
 *
 * `generated.d.ts` is the generated half (openapi-typescript output, never
 * hand-edited). This file is the handwritten half: authentication headers,
 * the §87 error envelope as a thrown Error, cursor pagination helpers, and
 * per-endpoint functions that bind generated request/response types.
 *
 * Idempotency-Key is mandatory on: shipment create, bulk import, COD collect,
 * delivery confirm, settlement approve, rider offline sync (rule 9). Those
 * functions take the key as a required parameter — a caller cannot forget it.
 */

import type { components, operations, paths } from './generated.js';

export type { components, operations, paths };

/** RFC 9457 problem details + `code` + `request_id`. See docs/api/errors.md. */
export interface ApiErrorEnvelope {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly request_id: string;
}

export class ZipZapApiError extends Error {
  constructor(
    readonly envelope: ApiErrorEnvelope,
    readonly retryAfterSeconds: number | null,
  ) {
    super(`${envelope.code}: ${envelope.detail}`);
    this.name = 'ZipZapApiError';
  }

  get status(): number {
    return this.envelope.status;
  }

  get code(): string {
    return this.envelope.code;
  }
}

export interface ClientOptions {
  readonly baseUrl: string;
  /** Sent as `Authorization: ApiKey <key_id>.<secret>` for machine principals. */
  readonly apiKey?: string;
  /** Sent as `Authorization: Bearer <token>` for human sessions. Exactly one of
   *  apiKey / bearerToken must be set at call time; a client is single-principal. */
  readonly bearerToken?: string;
  readonly fetchImpl?: typeof fetch;
}

type ShipmentPaths = paths['/v1/shipments'];
type ListQuery =
  NonNullable<ShipmentPaths['get']> extends never
    ? { limit?: string; cursor?: string }
    : NonNullable<ShipmentPaths['get']['parameters']['query']>;

export interface HubSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly networkZone: string | null;
  readonly lng: number | null;
  readonly lat: number | null;
  /** Parcels currently waiting at this hub. 0 for an empty hub, never null. */
  readonly countAtHub: number;
}

/** One parcel waiting at a hub. */
export interface ParcelPresence {
  readonly shipmentId: string;
  readonly trackingCode: string;
  readonly hubCode: string;
  readonly lastScan: string;
  readonly scannedAt: string;
  /** Null once arrived — there is no further hub gesture for this parcel. */
  readonly nextScan: string | null;
}

export interface HubWorkList {
  readonly hub: HubSummary;
  readonly parcels: ParcelPresence[];
}

export type HubScanKind = 'INBOUND' | 'SORT' | 'OUTBOUND' | 'DEPARTED' | 'ARRIVED';

export interface HubScanInput {
  readonly shipmentId: string;
  readonly scan: HubScanKind;
  readonly hubCode?: string | null;
}

export interface HubScanResult {
  readonly shipmentId: string;
  readonly scan: HubScanKind;
  readonly status: string;
  readonly hubCode: string | null;
}

export type ManifestEdge = 'seal' | 'dispatch' | 'receive' | 'reconcile';

/**
 * Named because a screen has to switch on it — the hub console keys its legal-edge buttons off the
 * current status. Inlining the union at the field would force every caller to redeclare it, and the
 * redeclaration is where a sixth status would be forgotten.
 */
export type ManifestStatus = 'DRAFT' | 'SEALED' | 'DISPATCHED' | 'RECEIVED' | 'RECONCILED';

export interface ManifestSummary {
  readonly id: string;
  readonly code: string;
  readonly tripId: string;
  readonly status: ManifestStatus;
}

export interface ManifestDetail extends ManifestSummary {
  readonly itemCount: number;
  readonly items: ReadonlyArray<{ readonly shipmentId: string; readonly arrived: boolean }>;
  /** 0 before RECEIVED — nobody has looked yet, which is not the same as nothing missing. */
  readonly missingCount: number;
}

/* ---------------------------------------------------------------- control tower
 *
 * The live map. Hand-declared for the same reason as everything else in this file: the controller
 * returns an interface, not a decorated DTO, so `openapi-typescript` has no schema to emit. Read off a
 * live response from a running backend.
 */

/** One hub on the map. `lng`/`lat` are non-null because the controller drops hubs it cannot place —
 *  a marker nudged to a frame edge looks like a real position, so unplaceable hubs are not sent. */
export interface MapHub {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly networkZone: string | null;
  readonly lng: number;
  readonly lat: number;
  readonly parcelsWaiting: number;
}

/** One rider on the map, with the age of the fix — an operator needs it to know whether to believe the dot. */
export interface MapRider {
  readonly id: string;
  readonly displayName: string;
  readonly status: string;
  readonly lng: number;
  readonly lat: number;
  readonly staleSeconds: number;
  readonly currentJobId: string | null;
}

export interface NetworkMap {
  readonly hubs: readonly MapHub[];
  readonly riders: readonly MapRider[];
  /** Riders with no ping yet. Counted, never plotted. */
  readonly ridersWithoutPosition: number;
  readonly generatedAt: string;
}

export interface Page<T> {
  readonly data: T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/* ---------------------------------------------------------------- response shapes
 * Hand-declared, not generated: controllers return interfaces rather than
 * decorated DTOs, so `openapi-typescript` has no schema to emit for these (see
 * createShipment's note). Each one below was read off a live response from a
 * running backend — if you change a controller's return shape, change it here
 * and in the contract test together.
 */

/** GET /v1/me — the authenticated principal.
 *
 *  `merchantId` is the ACTIVE business; `merchantIds` is every business this
 *  login may act inside (one per membership). A session token carries the
 *  second field and an API key has exactly one entry — a machine credential
 *  must never be able to reach a second tenant. */
export interface Principal {
  readonly kind: 'human' | 'machine';
  readonly subjectId: string;
  readonly merchantId: string | null;
  readonly merchantIds: ReadonlyArray<string>;
  readonly scopes: ReadonlyArray<string>;
  readonly credentialId: string;
  readonly rateLimitPerMin?: number | null;
}

/** One row of GET /v1/shipments */
export interface ShipmentSummary {
  readonly id: string;
  readonly trackingCode: string;
  readonly status: string;
  readonly merchantReference: string | null;
  readonly codAmountMinor: number;
  readonly codCurrency: string;
  /** Priced-against zone. Null for rows created before the column existed. */
  readonly zone: string | null;
  readonly createdAt: string;
}

/** One entry of the merchant timeline. Distinct from the PUBLIC tracker: that
 *  one reads `public_timeline`, which has no actor and no metadata, so it cannot
 *  leak them by a filter mistake. These fields are merchant-only by design. */
export interface TimelineEntry {
  readonly eventType: string;
  readonly occurredAt: string;
  readonly actorType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** Non-null when this row corrects an earlier one; corrections never edit. */
  readonly correctsEventId: string | null;
}

/** GET /v1/shipments/:id */
export interface ShipmentDetail extends ShipmentSummary {
  readonly senderName: string;
  readonly senderPhone: string;
  readonly senderAddress: string;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly recipientAddress: string;
  readonly parcelWeightGrams: number;
  readonly parcelDescription: string;
  readonly pricingVersion: number;
  /**
   * Oldest first. Scoped to the merchant — carries the actor and the hub/rider
   * metadata that the public projection deliberately withholds.
   */
  readonly timeline: ReadonlyArray<TimelineEntry>;
}

/** POST /v1/shipments */
export interface CreatedShipment {
  readonly id: string;
  readonly trackingCode: string;
  readonly status: string;
  readonly createdAt: string;
  readonly replayed: boolean;
}

/** One priced line of POST /v1/pricing/quote. Money is integer minor units. */
export interface QuoteLine {
  readonly kind: string;
  readonly label: string;
  readonly amount: { readonly amountMinor: number; readonly currency: string };
}

/** POST /v1/pricing/quote — what the parcel will cost, before committing.
 *
 *  `version` is the frozen pricing version the quote was computed from. Send it
 *  back on create? No — the server prices at creation against the current
 *  version, and this is a preview. A quote is not a reservation, which is why
 *  the create screen must label it as an estimate. */
export interface Quote {
  readonly version: number;
  readonly currency: string;
  readonly lines: ReadonlyArray<QuoteLine>;
  readonly total: { readonly amountMinor: number; readonly currency: string };
}

/** One row of GET /v1/settlements. The itemised version is `SettlementStatement`, by id. */
export interface SettlementSummary {
  readonly id: string;
  readonly reference: string;
  readonly status: string;
  readonly frozenNetMinor: number;
  readonly currency: string;
  readonly createdAt: string;
}

/**
 * GET /v1/pricing/rate-card — the card, as THIS merchant's rates.
 *
 * `plan` is resolved from the merchant record, not requested. It used to be a body field on
 * POST /quote, which meant a caller could name the plan with the best discount and be quoted it.
 */
export interface RateCard {
  readonly version: number;
  readonly currency: string;
  readonly plan: string;
  readonly baseFeeMinor: number;
  readonly perKgMinor: number;
  readonly codFeeBps: number;
  readonly remoteAreaFeeMinor: number;
  readonly fragileFeeMinor: number;
  readonly packagingFeesMinor: Readonly<Record<string, number>>;
  readonly taxBps: number;
  /** Zero is a real answer and is returned rather than omitted. */
  readonly planDiscountBps: number;
  /** Worked examples, so the coefficients above are readable without holding a parcel. */
  readonly examples: ReadonlyArray<{ readonly label: string; readonly totalMinor: number }>;
}

/**
 * GET /v1/finance/balance — one derived number, with everything needed to argue with it.
 *
 * `balanceMinor` is THE figure. `lines` is why it is that figure, and `blocked` is why money is not
 * moving. A balance without a breakdown is a number nobody can question.
 */
/** One grouped line of the breakdown. Several ledger rows roll up into one of these. */
export interface BalanceLine {
  readonly type: string;
  readonly direction: 1 | -1;
  readonly amountMinor: number;
  readonly entries: number;
}

export interface MerchantBalance {
  readonly merchantId: string;
  readonly balanceMinor: number;
  readonly currency: string;
  /** The exact instant it was true. A balance without one is a rumour. */
  readonly asOf: string;
  readonly lines: ReadonlyArray<BalanceLine>;
  readonly blocked: ReadonlyArray<{ readonly status: string; readonly count: number }>;
  /** null when nothing is in the way. */
  readonly blockedReason: string | null;
  readonly nextSettlement: { readonly reference: string; readonly netMinor: number } | null;
}

/**
 * GET /v1/cod/exceptions — one line of the reconciliation work queue.
 *
 * `differenceMinor` is `collected - expected`, so positive means the rider took too much. Carried
 * pre-computed because every caller would otherwise subtract the same two numbers and some of them
 * would get the sign wrong.
 */
export interface CodException {
  readonly id: string;
  readonly shipmentId: string;
  readonly expectedMinor: number;
  readonly collectedMinor: number | null;
  readonly differenceMinor: number;
  readonly currency: string;
  readonly reviewNote: string | null;
  readonly createdAt: string;
}

export interface CodExceptionPage {
  readonly data: ReadonlyArray<CodException>;
  readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
}

/** One line of a settlement statement. `amountMinor` unsigned; `direction` carries the sign. */
export interface StatementLine {
  readonly entryId: string;
  readonly type: string;
  readonly direction: 1 | -1;
  readonly amountMinor: number;
  readonly memo: string | null;
  readonly occurredAt: string;
  readonly shipmentId: string | null;
}

/**
 * GET /v1/settlements/:id — the same statement GET .../statement.csv renders.
 *
 * One shape for both, produced by one function on the server. That is what makes the plan's exit
 * check ("its totals match what the screen showed") true rather than a coincidence.
 */
export interface SettlementStatement {
  readonly reference: string;
  readonly status: string;
  readonly currency: string;
  readonly createdAt: string;
  /** Frozen at approval. Exactly the sum of `lines`, or the server throws before responding. */
  readonly netMinor: number;
  readonly lines: ReadonlyArray<StatementLine>;
}

/** GET /v1/coverage — serviceability for one zone, before creating anything. */
export interface Coverage {
  readonly zone: string;
  readonly serviceable: boolean;
  /** null when serviceable; a sentence for a human when not. */
  readonly reason: string | null;
  readonly estimatedDays: number | null;
  readonly pickupAvailable: boolean;
  readonly deliveryAvailable: boolean;
  readonly codAvailable: boolean;
}

/** POST /v1/shipments/:id/{hold,release,exception} — all three return this. */
export interface ActionResult {
  readonly shipmentId?: string;
  readonly id?: string;
  readonly trackingCode?: string;
  readonly status: string;
}

/** GET /track/:trackingCode — public, no account. */
export interface PublicTracking {
  readonly trackingCode: string;
  readonly status: string | null;
  readonly timeline: ReadonlyArray<{
    readonly sequence: number;
    readonly event: string;
    readonly occurredAt: string;
  }>;
}

/** GET /v1/control-tower/live-counts — one snapshot of the whole network.
 *
 *  `outstandingAmountMinor` arrives as a decimal string: the controller
 *  serialises a bigint there, because a poisha amount past 2^53 would lose
 *  precision as a JSON number. Parse it only at the point of display. */
export interface LiveCounts {
  readonly timestamp: string;
  readonly shipments: {
    readonly total: number;
    readonly todayNew: number;
    readonly inTransit: number;
    readonly atHub: number;
    readonly sorting: number;
    readonly outForDelivery: number;
    readonly delivered: number;
    readonly failed: number;
    readonly returned: number;
    readonly returning: number;
    readonly cancelled: number;
    readonly onHold: number;
    readonly lostOrDamaged: number;
    readonly exception: number;
    readonly byStatus: Readonly<Record<string, number>>;
  };
  readonly pickups: {
    readonly total: number;
    readonly active: number;
    readonly pending: number;
    readonly completed: number;
    readonly failed: number;
    readonly expired: number;
    readonly cancelled: number;
    readonly byStatus: Readonly<Record<string, number>>;
  };
  readonly deliveries: {
    readonly total: number;
    readonly outForDelivery: number;
    readonly attempted: number;
    readonly attemptsRemaining: number;
    readonly failed: number;
    readonly delivered: number;
    readonly byStatus: Readonly<Record<string, number>>;
  };
  readonly cod: {
    readonly total: number;
    readonly expected: number;
    readonly outstanding: number;
    /** Integer minor units, decimal-string encoded. */
    readonly outstandingAmountMinor: string;
    readonly byStatus: Readonly<Record<string, number>>;
  };
  readonly riders: {
    readonly total: number;
    readonly online: number;
    readonly available: number;
    readonly offline: number;
    readonly suspended: number;
    readonly byStatus: Readonly<Record<string, number>>;
  };
  readonly hub: {
    readonly backlog: number;
    readonly networkHubs: number;
  };
}

function errorEnvelopeOf(body: unknown, status: number): ApiErrorEnvelope {
  if (typeof body === 'object' && body !== null && 'code' in body) {
    return body as ApiErrorEnvelope;
  }
  return {
    type: 'https://api.zipzap.example/errors/http-error',
    title: 'Unexpected error',
    status,
    code: 'HTTP_ERROR',
    detail: 'The request could not be processed.',
    request_id: 'unknown',
  };
}

/* ------------------------------------------------------------ bulk import
 * Hand-declared, like the shipment shapes above: the controller returns
 * interfaces, so the OpenAPI spec carries no schema for them. `BulkJobStatus`
 * is spelled out rather than derived, because the console branches on it — a
 * status it does not recognise must be a visible unknown, not a silent
 * fall-through to "still running" that never ends.
 */

export type BulkJobStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'PREVIEW'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'COMPLETED_WITH_ERRORS';

/** One row as the PREVIEW shows it: before anything has been created. */
export interface BulkPreviewRow {
  readonly lineNumber: number;
  readonly invoice: string;
  readonly outcome: string;
  readonly reason: string | null;
}

export interface BulkJob {
  readonly id: string;
  readonly merchantId: string;
  readonly filename: string;
  readonly status: BulkJobStatus;
  readonly totalRows: number;
  readonly processedRows: number;
  readonly succeededRows: number;
  readonly failedRows: number;
  readonly skippedRows: number;
}

export interface BulkPreview {
  readonly job: BulkJob;
  readonly rows: ReadonlyArray<BulkPreviewRow>;
}

export class ZipZapClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClientOptions) {
    // Bound, because a bare `fetch` invoked as a method of this class loses its
    // `this` and the browser throws "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const authorization = this.options.bearerToken
      ? `Bearer ${this.options.bearerToken}`
      : `ApiKey ${this.options.apiKey ?? ''}`;
    return {
      Authorization: authorization,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  private async request<T>(
    path: string,
    init: { method: string; query?: Record<string, string | undefined>; body?: unknown } & Record<
      string,
      unknown
    >,
    idempotencyKey?: string,
  ): Promise<{ data: T; headers: Awaited<ReturnType<typeof fetch>>['headers'] }> {
    const query = Object.entries(init.query ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
      .join('&');
    const url = `${this.options.baseUrl}${path}${query ? `?${query}` : ''}`;
    const response = await this.fetchImpl(url, {
      method: init.method,
      headers: this.headers(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const retryAfter = response.headers.get('Retry-After');
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ZipZapApiError(
        errorEnvelopeOf(body, response.status),
        retryAfter ? Number(retryAfter) : null,
      );
    }
    return {
      data: (response.status === 204 ? null : await response.json()) as T,
      headers: response.headers,
    };
  }

  /**
   * POST /v1/shipments — Idempotency-Key required by rule 9.
   *
   * The request body is bound to the generated DTO type. The response is NOT
   * bound: controllers return interfaces, not decorated DTOs, so the spec
   * carries no response schema (all `content?: never`). Claiming a generated
   * response type here would be a lie the compiler cannot catch — runtime
   * shape is asserted in the contract test instead.
   */
  async createShipment(
    body: components['schemas']['CreateShipmentDto'],
    idempotencyKey: string,
  ): Promise<CreatedShipment> {
    const { data } = await this.request<CreatedShipment>(
      '/v1/shipments',
      { method: 'POST', body },
      idempotencyKey,
    );
    return data;
  }

  /**
   * GET /v1/shipments — cursor-paginated, newest first.
   *
   * `status` is comma-separated when several are wanted (`'LOST,DAMAGED'`); `from`
   * and `to` are `yyyy-mm-dd` in Asia/Dhaka and both include their whole day. A
   * bad filter is a 400 naming the field — it never falls back to "no filter",
   * which would show the merchant their whole account as if the filter worked.
   */
  async listShipments(query?: ListQuery): Promise<Page<ShipmentSummary>> {
    const { data } = await this.request<{
      data: ShipmentSummary[];
      pagination: { nextCursor: string | null; hasMore: boolean };
    }>('/v1/shipments', { method: 'GET', query: query as Record<string, string | undefined> });
    return {
      data: data.data,
      nextCursor: data.pagination.nextCursor,
      hasMore: data.pagination.hasMore,
    };
  }

  /** GET /v1/shipments/:id — one of your shipments. */
  async getShipment(id: string): Promise<ShipmentDetail> {
    const { data } = await this.request<ShipmentDetail>(`/v1/shipments/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    return data;
  }

  /**
   * POST /v1/pricing/quote — what this parcel will cost. Read-only and
   * side-effect free, so no Idempotency-Key: quoting twice with the same inputs
   * returns the same quote by determinism, not by dedupe.
   */
  async quote(body: components['schemas']['QuoteDto']): Promise<Quote> {
    const { data } = await this.request<Quote>('/v1/pricing/quote', { method: 'POST', body });
    return data;
  }

  /** GET /v1/pricing/rate-card — your rates, with worked examples. No API key needed for a merchant. */
  async rateCard(): Promise<RateCard> {
    const { data } = await this.request<RateCard>('/v1/pricing/rate-card', { method: 'GET' });
    return data;
  }

  /** GET /v1/finance/balance — the one number, itemised, with anything blocking a payout. */
  async balance(): Promise<MerchantBalance> {
    const { data } = await this.request<MerchantBalance>('/v1/finance/balance', { method: 'GET' });
    return data;
  }

  /** GET /v1/settlements — your settlements, newest first. */
  async settlements(query?: ListQuery): Promise<Page<SettlementSummary>> {
    // `{data, pagination}` on the wire, flattened to `Page<T>` here — the same shape listShipments
    // returns, so the two lists paginate identically in the console.
    const { data } = await this.request<{
      data: SettlementSummary[];
      pagination: { nextCursor: string | null; hasMore: boolean };
    }>('/v1/settlements', { method: 'GET', query: query as Record<string, string | undefined> });
    return {
      data: data.data,
      nextCursor: data.pagination.nextCursor,
      hasMore: data.pagination.hasMore,
    };
  }

  /** GET /v1/settlements/:id — one settlement, itemised. */
  async settlement(id: string): Promise<SettlementStatement> {
    const { data } = await this.request<SettlementStatement>(
      `/v1/settlements/${encodeURIComponent(id)}`,
      { method: 'GET' },
    );
    return data;
  }

  /**
   * GET /v1/settlements/:id/statement.csv — the same statement, as a download.
   *
   * TEXT, not JSON, for the reason `bulkResultCsv` documents: going through `request()` would give a
   * quoted string with escaped newlines, which is a CSV nobody can open. The caller builds a Blob,
   * because a plain <a href> cannot carry the Authorization header.
   */
  async statementCsv(id: string): Promise<string> {
    const response = await this.fetchImpl(
      `${this.options.baseUrl}/v1/settlements/${encodeURIComponent(id)}/statement.csv`,
      { method: 'GET', headers: this.headers() },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ZipZapApiError(errorEnvelopeOf(body, response.status), null);
    }
    return response.text();
  }

  /** GET /v1/cod/exceptions — the reconciliation work queue, newest first. */
  async codExceptions(query?: ListQuery): Promise<CodExceptionPage> {
    const { data } = await this.request<CodExceptionPage>('/v1/cod/exceptions', {
      method: 'GET',
      query,
    });
    return data;
  }

  /* ---------------------------------------------------------------- hub console
   *
   * The hub console is a different principal from the merchant console, but the same client:
   * a bearer token either has `hub:read` + `hub:scan` or it does not, and the server decides.
   * No client-side notion of "which console am I" — that would be a second source of truth about
   * permissions, and the one that is wrong whenever a role changes.
   */

  /** GET /v1/hubs — every hub and how many parcels are waiting at it. */
  async hubs(): Promise<HubSummary[]> {
    const { data } = await this.request<HubSummary[]>('/v1/hubs', { method: 'GET' });
    return data;
  }

  /** GET /v1/hubs/:hubCode/parcels — the work list, and the gesture each parcel needs next. */
  async hubParcels(hubCode: string): Promise<HubWorkList> {
    const { data } = await this.request<HubWorkList>(
      `/v1/hubs/${encodeURIComponent(hubCode)}/parcels`,
      {
        method: 'GET',
      },
    );
    return data;
  }

  /**
   * POST /v1/hubs/scans — the only primary action in the console.
   *
   * A 409 throws `ZipZapApiError` carrying the machine's message, which names the state the parcel
   * was in and the one the scan wanted. That message is the screen's entire error display: an
   * operator who scanned the wrong gesture needs to know WHICH gesture, and the server is the only
   * party that knows.
   */
  async scan(input: HubScanInput): Promise<HubScanResult> {
    const { data } = await this.request<HubScanResult>('/v1/hubs/scans', {
      method: 'POST',
      body: input,
    });
    return data;
  }

  /** GET /v1/manifests — every manifest, newest first, optionally filtered by status. */
  async manifests(status?: string): Promise<{ data: ManifestSummary[] }> {
    const { data } = await this.request<{ data: ManifestSummary[] }>('/v1/manifests', {
      method: 'GET',
      query: { status },
    });
    return data;
  }

  /** GET /v1/manifests/:id — the cargo list, with each parcel's arrival resolved. */
  async manifest(id: string): Promise<ManifestDetail> {
    const { data } = await this.request<ManifestDetail>(`/v1/manifests/${id}`, { method: 'GET' });
    return data;
  }

  /**
   * POST /v1/manifests/:id/<edge> — seal, dispatch, receive or reconcile.
   *
   * One method rather than four: the edges differ only in the path, and four methods would be four
   * signatures to keep aligned with the machine. A 409 still throws with both states named.
   */
  manifestTransition(id: string, edge: ManifestEdge): Promise<ManifestSummary> {
    return this.request<ManifestSummary>(`/v1/manifests/${id}/${edge}`, {
      method: 'POST',
      body: {},
    }).then(({ data }) => data);
  }

  /* ---------------------------------------------------------------- hub console
   *
   * The hub console is a different principal from the merchant console, but the same client:
   * a bearer token either has `hub:read` + `hub:scan` or it does not, and the server decides.
   * No client-side notion of "which console am I" — that would be a second source of truth about
   * permissions, and the one that is wrong whenever a role changes.
   */

  /** GET /v1/control-tower/map — hubs and rider positions in one read. */
  async networkMap(): Promise<NetworkMap> {
    const { data } = await this.request<NetworkMap>('/v1/control-tower/map', { method: 'GET' });
    return data;
  }

  /** POST /v1/riders/:riderId/position — where a rider is now. Never public. */
  async recordRiderPosition(
    riderId: string,
    position: { latitude: number; longitude: number; recordedAt: string; accuracyMeters?: number },
  ): Promise<{
    riderId: string;
    latitude: number;
    longitude: number;
    recordedAt: string;
    ageSeconds: number;
  }> {
    const { data } = await this.request<{
      riderId: string;
      latitude: number;
      longitude: number;
      recordedAt: string;
      ageSeconds: number;
    }>(`/v1/riders/${encodeURIComponent(riderId)}/position`, { method: 'POST', body: position });
    return data;
  }

  /** GET /v1/coverage — is this zone serviceable, and in how many days? */
  async coverage(zone: string): Promise<Coverage> {
    const { data } = await this.request<Coverage>('/v1/coverage', {
      method: 'GET',
      query: { zone },
    });
    return data;
  }

  /**
   * GET /v1/zones — every zone that can be shipped to, for a picker.
   *
   * Read from the server rather than hardcoded: zones are network configuration
   * and a stale list in the console offers a retired zone and hides a new one.
   */
  async zones(): Promise<string[]> {
    const { data } = await this.request<{ zones: string[] }>('/v1/zones', { method: 'GET' });
    return data.zones;
  }

  /**
   * POST /v1/shipments/:id/cancel — irreversible in practice (the parcel is
   * gone), so the caller must confirm with a human before calling this.
   */
  async cancelShipment(id: string): Promise<ActionResult> {
    const { data } = await this.request<ActionResult>(
      `/v1/shipments/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' },
    );
    return data;
  }

  /** POST /v1/shipments/:id/hold — pauses movement, resumable by release. */
  async holdShipment(id: string, reason?: string): Promise<ActionResult> {
    const { data } = await this.request<ActionResult>(
      `/v1/shipments/${encodeURIComponent(id)}/hold`,
      { method: 'POST', body: { reason: reason ?? null } },
    );
    return data;
  }

  /** POST /v1/shipments/:id/release — resumes a held shipment where it stopped. */
  async releaseShipment(id: string): Promise<ActionResult> {
    const { data } = await this.request<ActionResult>(
      `/v1/shipments/${encodeURIComponent(id)}/release`,
      { method: 'POST' },
    );
    return data;
  }

  /** POST /v1/shipments/:id/exception — report LOST or DAMAGED. */
  async reportException(
    id: string,
    reason: 'LOST' | 'DAMAGED',
    note?: string,
  ): Promise<ActionResult> {
    const { data } = await this.request<ActionResult>(
      `/v1/shipments/${encodeURIComponent(id)}/exception`,
      { method: 'POST', body: { reason, note: note ?? null } },
    );
    return data;
  }

  /* ---------------------------------------------------------------- rider mobile
   *
   * The rider app interacts with offline sync and job execution.
   */

  /** GET /v1/riders/:riderId/jobs — one rider's pickups and delivery jobs. */
  async riderJobs(
    riderId: string,
    limit?: number,
  ): Promise<{
    pickups: Array<{
      id: string;
      merchantId: string;
      shipmentIds: string[];
      riderId: string | null;
      status: string;
      totalWeightGrams: number;
      createdAt: string;
    }>;
    deliveries: Array<{
      id: string;
      shipmentId: string;
      riderId: string;
      status: string;
      attemptsMade: number;
      lastFailureReason: string | null;
      createdAt: string;
    }>;
  }> {
    const { data } = await this.request<{
      pickups: Array<{
        id: string;
        merchantId: string;
        shipmentIds: string[];
        riderId: string | null;
        status: string;
        totalWeightGrams: number;
        createdAt: string;
      }>;
      deliveries: Array<{
        id: string;
        shipmentId: string;
        riderId: string;
        status: string;
        attemptsMade: number;
        lastFailureReason: string | null;
        createdAt: string;
      }>;
    }>(`/v1/riders/${encodeURIComponent(riderId)}/jobs`, {
      method: 'GET',
      query: limit !== undefined ? { limit: String(limit) } : {},
    });
    return data;
  }

  /** GET /v1/control-tower/live-counts — the control tower snapshot. */
  async liveCounts(): Promise<LiveCounts> {
    const { data } = await this.request<LiveCounts>('/v1/control-tower/live-counts', {
      method: 'GET',
    });
    return data;
  }

  /** GET /track/:trackingCode — public, no account. */
  async track(trackingCode: string): Promise<PublicTracking> {
    const { data } = await this.request<PublicTracking>(
      `/track/${encodeURIComponent(trackingCode)}`,
      { method: 'GET' },
    );
    return data;
  }

  /**
   * POST /v1/auth/login — email + scrypt password → 12h bearer session.
   *
   * `merchantId` picks which business to open the session against for a person
   * who belongs to several. It is a REQUEST for a scope: the server refuses a
   * business the user does not hold rather than falling back to a default.
   */
  async login(
    email: string,
    password: string,
    merchantId?: string,
  ): Promise<{
    token: string;
    expiresAt: string;
    tokenType: string;
    merchantId: string;
    merchantIds: ReadonlyArray<string>;
  }> {
    const { data } = await this.request('/v1/auth/login', {
      method: 'POST',
      body: { email, password, ...(merchantId ? { merchantId } : {}) },
    });
    return data as {
      token: string;
      expiresAt: string;
      tokenType: string;
      merchantId: string;
      merchantIds: ReadonlyArray<string>;
    };
  }

  /** GET /v1/me — what the server thinks this principal is. */
  async getMe(): Promise<Principal> {
    const { data } = await this.request<Principal>('/v1/me', { method: 'GET' });
    return data;
  }

  /** POST /v1/auth/logout — revoke the bearer session (204, idempotent). */
  async logout(): Promise<void> {
    await this.request('/v1/auth/logout', { method: 'POST' });
  }
  /**
   * POST /v1/shipments/bulk/upload — CSV text in, the human checkpoint out.
   *
   * No Idempotency-Key, unlike `createShipment`: a re-upload is a NEW preview to
   * correct, not a replay of the same one, and rule 9 lists bulk import because
   * the *accepted* job is idempotent — on merchant invoice reference, inside the
   * processor — not because the upload is.
   *
   * The whole file comes back as rows. A 10,000-row upload is a 10,000-element
   * array; the console shows the problems and summarises the rest rather than
   * rendering 10,000 <tr>s.
   */
  async uploadBulk(filename: string, csv: string): Promise<BulkPreview> {
    const { data } = await this.request<BulkPreview>('/v1/shipments/bulk/upload', {
      method: 'POST',
      body: { filename, csv },
    });
    return data;
  }

  /**
   * POST /v1/shipments/bulk/accept — the checkpoint. Moves PREVIEW to
   * PROCESSING and enqueues one chunk job per 100 rows.
   *
   * Partial failure is a success state: `COMPLETED_WITH_ERRORS` means the job
   * finished and there is a result file, not that the import failed.
   */
  async acceptBulk(jobId: string): Promise<BulkJob> {
    const { data } = await this.request<BulkJob>('/v1/shipments/bulk/accept', {
      method: 'POST',
      body: { jobId },
    });
    return data;
  }

  async bulkProgress(jobId: string): Promise<BulkJob> {
    const { data } = await this.request<BulkJob>(
      `/v1/shipments/bulk/${encodeURIComponent(jobId)}`,
      { method: 'GET' },
    );
    return data;
  }

  /**
   * GET /v1/shipments/bulk/:jobId/result — the per-row outcome as CSV.
   *
   * Returned as TEXT, not JSON. The controller sets `text/csv` and
   * `Content-Disposition`; going through `request()` and parsing JSON would give
   * a quoted string with escaped newlines, which is a CSV nobody can open. The
   * caller builds a Blob from it, because a plain <a href> cannot carry the
   * Authorization header.
   */
  async bulkResultCsv(jobId: string): Promise<string> {
    const response = await this.fetchImpl(
      `${this.options.baseUrl}/v1/shipments/bulk/${encodeURIComponent(jobId)}/result`,
      { method: 'GET', headers: this.headers() },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ZipZapApiError(errorEnvelopeOf(body, response.status), null);
    }
    return response.text();
  }

  /* ---------------------------------------------------------------- rider mobile
   *
   * The rider app interacts with offline sync and job execution.
   */

  /** GET /v1/riders/:riderId/sync — pull work queued for this rider. */
  async pullRiderSync(
    riderId: string,
    options?: { sinceSeq?: string; limit?: string },
  ): Promise<{
    commands: Array<{
      id: string;
      commandType: string;
      payload: Record<string, unknown>;
      expectedState: Record<string, unknown> | null;
      deviceSequence: number;
      createdAt: string;
    }>;
    queueSize: number;
    capWarning: boolean;
  }> {
    const { data } = await this.request<{
      commands: Array<{
        id: string;
        commandType: string;
        payload: Record<string, unknown>;
        expectedState: Record<string, unknown> | null;
        deviceSequence: number;
        createdAt: string;
      }>;
      queueSize: number;
      capWarning: boolean;
    }>(`/v1/riders/${encodeURIComponent(riderId)}/sync`, {
      method: 'GET',
      query: options,
    });
    return data;
  }

  /** POST /v1/riders/:riderId/sync/ack — acknowledge work executed. */
  async ackRiderSync(
    riderId: string,
    commandId: string,
    idempotencyKey: string,
  ): Promise<{
    outcome: { kind: string; replayed: boolean };
    createdAt: string;
  }> {
    const { data } = await this.request<{
      outcome: { kind: string; replayed: boolean };
      createdAt: string;
    }>(
      `/v1/riders/${encodeURIComponent(riderId)}/sync/ack`,
      {
        method: 'POST',
        body: { commandId },
      },
      idempotencyKey,
    );
    return data;
  }

  /** POST /v1/riders/:riderId/sync/replay — device pushing its queued work batch. */
  async replayRiderSync(
    riderId: string,
    commands: Array<{
      deviceSequence: number;
      createdAt: string;
      commandType: string;
      payload: Record<string, unknown>;
      expectedState?: Record<string, unknown>;
    }>,
  ): Promise<{
    results: Array<{
      deviceSequence: number;
      commandId: string;
      kind: 'applied' | 'rejected' | 'duplicate';
      reason: string | null;
    }>;
    queueSize: number;
    capWarning: boolean;
  }> {
    const { data } = await this.request<{
      results: Array<{
        deviceSequence: number;
        commandId: string;
        kind: 'applied' | 'rejected' | 'duplicate';
        reason: string | null;
      }>;
      queueSize: number;
      capWarning: boolean;
    }>(`/v1/riders/${encodeURIComponent(riderId)}/sync/replay`, {
      method: 'POST',
      body: { commands },
    });
    return data;
  }

  /* ---------------------------------------------------------------- proof of delivery
   *
   * The recipient's confirmation, the photo, and where it happened. Two calls because they are
   * two moments: a code is minted at the door and read out seconds later.
   */

  /** POST /v1/deliveries/:id/proof/code — mint a code for the customer to read out. */
  async issueDeliveryCode(jobId: string): Promise<{
    jobId: string;
    status: 'PENDING';
    expiresAt: string;
    attemptsRemaining: number;
    code: string;
  }> {
    const { data } = await this.request<{
      jobId: string;
      status: 'PENDING';
      expiresAt: string;
      attemptsRemaining: number;
      code: string;
    }>(`/v1/deliveries/${encodeURIComponent(jobId)}/proof/code`, { method: 'POST' });
    return data;
  }

  /**
   * POST /v1/deliveries/:id/proof — redeem the code with a photo and a location.
   *
   * `idempotencyKey` is mandatory server-side: a lost response on a bad connection must not record
   * two proofs, and must not spend a second attempt for what was one guess.
   */
  async submitDeliveryProof(
    jobId: string,
    body: {
      code: string;
      photoBase64: string;
      photoContentType: string;
      latitude: number;
      longitude: number;
    },
    idempotencyKey: string,
  ): Promise<{
    jobId: string;
    proofId: string;
    status: 'VERIFIED';
    photoSha256: string;
    photoByteLength: number;
    otpVerifiedAt: string;
    replayed: boolean;
  }> {
    const { data } = await this.request<{
      jobId: string;
      proofId: string;
      status: 'VERIFIED';
      photoSha256: string;
      photoByteLength: number;
      otpVerifiedAt: string;
      replayed: boolean;
    }>(`/v1/deliveries/${encodeURIComponent(jobId)}/proof`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return data;
  }

  /* ---------------------------------------------------------------- notification preferences */

  /**
   * GET /v1/notification-preferences — which parcel events this merchant's customers hear about.
   *
   * The server answers for every event, not only the stored ones, so the screen can show a toggle
   * per event and mark the ones still on their default.
   */
  async notificationPreferences(): Promise<
    Array<{
      eventType: string;
      templateName: string;
      enabled: boolean;
      isDefault: boolean;
    }>
  > {
    const { data } = await this.request<
      Array<{
        eventType: string;
        templateName: string;
        enabled: boolean;
        isDefault: boolean;
      }>
    >('/v1/notification-preferences', { method: 'GET' });
    return data;
  }

  /** PUT /v1/notification-preferences — opt one event out, or back in. */
  async setNotificationPreference(
    eventType: string,
    enabled: boolean,
  ): Promise<{ eventType: string; templateName: string; enabled: boolean; isDefault: boolean }> {
    const { data } = await this.request<{
      eventType: string;
      templateName: string;
      enabled: boolean;
      isDefault: boolean;
    }>('/v1/notification-preferences', {
      method: 'PUT',
      body: { eventType, enabled },
    });
    return data;
  }

  /* ---------------------------------------------------------------- developer & webhooks
   *
   * Developer portal & webhook management for merchants.
   */

  /** GET /v1/webhooks — list your registered webhook endpoints */
  async listWebhooks(): Promise<
    Array<{
      id: string;
      merchantId: string;
      url: string;
      events: string[];
      status: 'ACTIVE' | 'PAUSED';
      createdAt: string;
    }>
  > {
    const { data } = await this.request<
      Array<{
        id: string;
        merchantId: string;
        url: string;
        events: string[];
        status: 'ACTIVE' | 'PAUSED';
        createdAt: string;
      }>
    >('/v1/webhooks', { method: 'GET' });
    return data;
  }

  /** POST /v1/webhooks — register a new webhook endpoint (returns secret once) */
  async createWebhook(body: { url: string; events: string[] }): Promise<{
    endpoint: {
      id: string;
      merchantId: string;
      url: string;
      events: string[];
      status: 'ACTIVE' | 'PAUSED';
      createdAt: string;
    };
    secret: string;
  }> {
    const { data } = await this.request<{
      endpoint: {
        id: string;
        merchantId: string;
        url: string;
        events: string[];
        status: 'ACTIVE' | 'PAUSED';
        createdAt: string;
      };
      secret: string;
    }>('/v1/webhooks', { method: 'POST', body });
    return data;
  }

  /** GET /v1/webhooks/deliveries — delivery attempts log */
  async listWebhookDeliveries(options?: {
    endpointId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    data: Array<{
      id: string;
      endpointId: string;
      eventType: string;
      attempt: number;
      statusCode: number | null;
      error: string | null;
      delivered: boolean;
      terminal: boolean;
      attemptedAt: string;
    }>;
    nextCursor: string | null;
  }> {
    const { data } = await this.request<{
      data: Array<{
        id: string;
        endpointId: string;
        eventType: string;
        attempt: number;
        statusCode: number | null;
        error: string | null;
        delivered: boolean;
        terminal: boolean;
        attemptedAt: string;
      }>;
      nextCursor: string | null;
    }>('/v1/webhooks/deliveries', {
      method: 'GET',
      query: {
        endpointId: options?.endpointId,
        cursor: options?.cursor,
        limit: options?.limit !== undefined ? String(options.limit) : undefined,
      },
    });
    return data;
  }

  /** POST /v1/webhooks/deliveries/:deliveryId/replay — replay a failed delivery */
  async replayWebhookDelivery(deliveryId: string): Promise<{
    deliveryId: string;
    endpointId: string;
    wireEvent: string;
  }> {
    const { data } = await this.request<{
      deliveryId: string;
      endpointId: string;
      wireEvent: string;
    }>(`/v1/webhooks/deliveries/${encodeURIComponent(deliveryId)}/replay`, {
      method: 'POST',
      body: {},
    });
    return data;
  }

  /** POST /v1/api-keys — mint a new merchant API key (secret returned once) */
  async createApiKey(body: { name: string; scopes: string[] }): Promise<{
    id: string;
    keyId: string;
    secret: string;
    name: string;
    scopes: string[];
  }> {
    const { data } = await this.request<{
      id: string;
      keyId: string;
      secret: string;
      name: string;
      scopes: string[];
    }>('/v1/api-keys', { method: 'POST', body });
    return data;
  }
}
