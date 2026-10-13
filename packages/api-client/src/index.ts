/**
 * @zipzap/api-client — typed HTTP client for the ZipZap v1 API.
 *
 * `generated.d.ts` is the generated half (openapi-typescript output from
 * apps/backend/openapi.json, never hand-edited). Every response type below is
 * bound to a schema in it — nothing here reads a live response to write down a
 * shape by hand.
 *
 * This file is the half that cannot be generated, because it is behaviour
 * rather than description: authentication headers, the §87 error envelope as a
 * thrown Error, cursor pagination flattening, and the two CSV endpoints that
 * must be read as text rather than parsed as JSON.
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

/**
 * The credentials mode a `fetch` call uses. Declared locally rather than taken from the DOM lib,
 * because this package is also used from Node — the backend's own export script and the rider app
 * both run without a DOM, and `RequestCredentials` does not exist there.
 */
type CredentialsMode = 'omit' | 'same-origin' | 'include';

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
  /**
   * Credentials mode for the underlying `fetch`. Defaults to `same-origin`.
   *
   * A browser console authenticates with the `zipzap_session` cookie, which the browser attaches
   * on a same-origin request with no script involvement — so the client must not send
   * `credentials: 'omit'`, or every call silently arrives unauthenticated and the console fails to
   * load anything while reporting no error. A caller that genuinely wants no credential (`login`,
   * the public tracking route) asks for it explicitly.
   */
  readonly credentials?: CredentialsMode;
  /**
   * Per-call escape hatch, applied to every request this client makes.
   *
   * For a call made from a server-side render: `createServerFn` hands the handler a request whose
   * cookies must be copied onto the outgoing fetch, and a relative `baseUrl` needs an origin it can
   * resolve against. Rather than bake either into the client, this lets the caller translate the
   * incoming request into fetch options it is the only party that can see.
   */
  readonly onRequest?: (input: string, init: RequestInit) => RequestInit | Promise<RequestInit>;
  readonly fetchImpl?: typeof fetch;
}

type ShipmentPaths = paths['/v1/shipments'];
type ListQuery =
  NonNullable<ShipmentPaths['get']> extends never
    ? { limit?: string; cursor?: string }
    : NonNullable<ShipmentPaths['get']['parameters']['query']>;

/* ------------------------------------------------------------------ response types
 *
 * Thin aliases onto `generated.d.ts`. They exist so a call site can write
 * `ShipmentSummary` in a React component instead of
 * `components['schemas']['ShipmentSummaryDto']`, and so the name carries intent —
 * `Principal` and `ShipmentSummary` are different things the server happens to
 * describe in the same vocabulary.
 *
 * Before 2026-10-10 these were 32 hand-declared interfaces read off live
 * responses, because controllers returned TypeScript interfaces and the spec had
 * no response schemas at all. They now alias generated schemas, so a controller
 * change that breaks one of them is a compile error here rather than a runtime
 * surprise in a console.
 */

type Schemas = components['schemas'];

export type HubSummary = Schemas['HubSummaryDto'];
export type MyHub = Schemas['MyHubDto'];
export type HubWorkList = Schemas['HubParcelsViewDto'];
export type HubScanResult = Schemas['HubScanResultDto'];
export type HubScanInput = Schemas['HubScanDto'];
export type HubScanKind = Schemas['HubScanDto']['scan'];
/** One parcel waiting at a hub, from the hub console's work list. */
export type ParcelPresence = Schemas['ParcelPresenceDto'];
export type ManifestDetail = Schemas['ManifestDetailDto'];
export type MapHub = Schemas['MapHubDto'];
export type MapRider = Schemas['MapRiderDto'];
export type NetworkMap = Schemas['NetworkMapDto'];
export type Principal = Schemas['ApiPrincipalResponseDto'];
export type ShipmentSummary = Schemas['ShipmentSummaryDto'];
export type TimelineEntry = Schemas['TimelineEntryDto'];
export type ShipmentDetail = Schemas['ShipmentDetailDto'];
export type CreatedShipment = Schemas['CreatedShipmentDto'];
export type Quote = Schemas['QuoteResponseDto'];
export type RateCard = Schemas['RateCardResponseDto'];
export type BalanceLine = Schemas['BalanceLineDto'];
export type MerchantBalance = Schemas['MerchantBalanceDto'];
export type CodException = Schemas['CodExceptionDto'];
export type StatementLine = Schemas['StatementLineDto'];
export type SettlementStatement = Schemas['SettlementStatementDto'];
export type Coverage = Schemas['CoverageCheckDto'];
export type LiveCounts = Schemas['LiveCountsDto'];

/**
 * GET /v1/shipments/counts. Every shipment status is present, at zero when there are none, so a
 * caller never has to treat a missing key as a number.
 */
export type ShipmentCounts = Schemas['ShipmentCountsDto'];
export type PublicTracking = Schemas['PublicTrackingViewDto'];
export type BulkPreviewRow = Schemas['BulkPreviewRowDto'];
export type BulkJob = Schemas['BulkJobViewDto'];
export type BulkPreview = Schemas['BulkPreviewDto'];
export type CancelledShipment = Schemas['CancelledShipmentDto'];
export type HeldShipment = Schemas['HeldShipmentDto'];
export type IssuedDeliveryCode = Schemas['IssuedDeliveryCodeDto'];
export type SubmittedDeliveryProof = Schemas['SubmittedDeliveryProofDto'];
export type RiderPosition = Schemas['RiderPositionDto'];
export type RiderJobs = Schemas['RiderJobsDto'];
export type RiderPullResult = Schemas['PullResultDto'];
export type RiderReplayResult = Schemas['ReplayResultDto'];
export type RiderAckResult = Schemas['AckResultDto'];
export type WebhookEndpoint = Schemas['EndpointViewDto'];
export type CreatedWebhookEndpoint = Schemas['CreatedEndpointDto'];
export type WebhookDeliveryRow = Schemas['DeliveryLogRowDto'];
export type CreatedApiKey = Schemas['CreatedApiKeyDto'];
export type MerchantSeries = Schemas['MerchantSeriesDto'];
export type MerchantDayPoint = Schemas['MerchantDayPointDto'];
export type NotificationPreference = Schemas['NotificationPreferenceDto'];
export type ManifestSummary = Schemas['ManifestViewDto'];
export type ManifestEdge = 'seal' | 'dispatch' | 'receive' | 'reconcile';
export type ManifestStatus = Schemas['ManifestViewDto']['status'];
export type SettlementSummary = Schemas['SettlementSummaryDto'];

/** A cursor-paginated page, as `CursorPaginationDto` describes it. */
export type Page<T> = {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
};

/**
 * POST /v1/shipments/:id/{hold,release,cancel,exception} — three of the four
 * machine edges return a different envelope, so there is no single `ActionResult`
 * type to alias. Named because a screen has to switch on it.
 */
export type ShipmentEdge =
  Schemas['HeldShipmentDto'] | Schemas['CancelledShipmentDto'] | Schemas['ReportedExceptionDto'];

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
 * `BulkJobStatus` is spelled out rather than taken from the generated union,
 * because the console branches on it — a status it does not recognise must be a
 * visible unknown, not a silent fall-through to "still running" that never ends.
 */

export type BulkJobStatus = Schemas['BulkJobViewDto']['status'];

export class ZipZapClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClientOptions) {
    // Bound, because a bare `fetch` invoked as a method of this class loses its
    // `this` and the browser throws "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    // Only send the header when there is a credential to state. A client with neither — the browser
    // console, authenticating with the `zipzap_session` cookie — must send nothing, because the
    // server treats an `Authorization` header naming no recognised scheme as a rejection rather
    // than falling through to the cookie. Sending `ApiKey ` with an empty value is not "no
    // credential", it is a malformed one, and it makes every cookie-authenticated call fail.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    };
    if (this.options.bearerToken) {
      headers.Authorization = `Bearer ${this.options.bearerToken}`;
    } else if (this.options.apiKey) {
      headers.Authorization = `ApiKey ${this.options.apiKey}`;
    }
    return headers;
  }

  /**
   * Applies the caller's `onRequest` translator, if there is one.
   *
   * Every request in this class funnels through here, so a caller that needs to rewrite a URL or
   * copy headers has exactly one place to do it — rather than the alternative, where the JSON paths
   * honour it and the two CSV paths quietly do not, and the console downloads an error envelope
   * named `statement.csv`.
   *
   * The URL is not passed through `onRequest`: the first argument to `fetch` is the URL, so a
   * translator that returns `{ url }` in the init is ignored by `fetch` and the original relative
   * path is used — which fails with `ERR_INVALID_URL` on a server-side render, where a bare
   * `/api/v1/me` has no origin to resolve against. Instead the translator is expected to put the
   * absolute URL in the returned init's `url`, and it IS forwarded to `fetch` as the first argument.
   */
  private async withOnRequest(url: string, init: RequestInit): Promise<[string, RequestInit]> {
    if (!this.options.onRequest) return [url, init];
    const result = await this.options.onRequest(url, init);
    const finalUrl = (result as RequestInit & { url?: string }).url ?? url;
    return [finalUrl, result];
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
    const [finalUrl, finalInit] = await this.withOnRequest(url, {
      method: init.method,
      headers: this.headers(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // The cookie rides same-origin. See the `credentials` note on ClientOptions for why this
      // must not be `omit`: it fails silently, with no console error, just a blank screen.
      credentials: this.options.credentials ?? 'same-origin',
    });
    const response = await this.fetchImpl(finalUrl, finalInit);
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
   * Body and response are both bound to generated schemas. The response used to be
   * a hand-written `CreatedShipment` because controllers returned interfaces and
   * the spec had no response schema; a shape drift then showed up as a runtime
   * surprise in a console rather than a compile error here.
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
    const statementUrl = `${this.options.baseUrl}/v1/settlements/${encodeURIComponent(id)}/statement.csv`;
    const [finalUrl, finalInit] = await this.withOnRequest(statementUrl, {
      method: 'GET',
      headers: this.headers(),
      credentials: this.options.credentials ?? 'same-origin',
    });
    const response = await this.fetchImpl(finalUrl, finalInit);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ZipZapApiError(errorEnvelopeOf(body, response.status), null);
    }
    return response.text();
  }

  /** GET /v1/cod/exceptions — the reconciliation work queue, newest first. */
  async codExceptions(query?: ListQuery): Promise<Page<CodException>> {
    // `{data, pagination}` on the wire, flattened to `Page<T>` here — the same shape
    // listShipments returns, so the two lists paginate identically in the console.
    const { data } = await this.request<{
      data: CodException[];
      pagination: { readonly nextCursor: string | null; readonly hasMore: boolean };
    }>('/v1/cod/exceptions', {
      method: 'GET',
      query,
    });
    return {
      data: data.data,
      nextCursor: data.pagination.nextCursor,
      hasMore: data.pagination.hasMore,
    };
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

  /** GET /v1/hubs/my-hub — the hub the caller is assigned to (404 if not assigned). */
  async myHub(): Promise<HubSummary> {
    const { data } = await this.request<HubSummary>('/v1/hubs/my-hub', { method: 'GET' });
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
  ): Promise<RiderPosition> {
    const { data } = await this.request<RiderPosition>(
      `/v1/riders/${encodeURIComponent(riderId)}/position`,
      { method: 'POST', body: position },
    );
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
  async cancelShipment(id: string): Promise<CancelledShipment> {
    const { data } = await this.request<CancelledShipment>(
      `/v1/shipments/${encodeURIComponent(id)}/cancel`,
      { method: 'POST' },
    );
    return data;
  }

  /** POST /v1/shipments/:id/hold — pauses movement, resumable by release. */
  async holdShipment(id: string, reason?: string): Promise<HeldShipment> {
    const { data } = await this.request<HeldShipment>(
      `/v1/shipments/${encodeURIComponent(id)}/hold`,
      { method: 'POST', body: { reason: reason ?? null } },
    );
    return data;
  }

  /** POST /v1/shipments/:id/release — resumes a held shipment where it stopped. */
  async releaseShipment(id: string): Promise<ShipmentEdge> {
    const { data } = await this.request<ShipmentEdge>(
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
  ): Promise<ShipmentEdge> {
    const { data } = await this.request<ShipmentEdge>(
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
  async riderJobs(riderId: string, limit?: number): Promise<RiderJobs> {
    const { data } = await this.request<RiderJobs>(
      `/v1/riders/${encodeURIComponent(riderId)}/jobs`,
      {
        method: 'GET',
        query: limit !== undefined ? { limit: String(limit) } : {},
      },
    );
    return data;
  }

  /** GET /v1/control-tower/live-counts — the control tower snapshot. Network scope, not a merchant's. */
  async liveCounts(): Promise<LiveCounts> {
    const { data } = await this.request<LiveCounts>('/v1/control-tower/live-counts', {
      method: 'GET',
    });
    return data;
  }

  /**
   * GET /v1/shipments/counts — your own shipments by status.
   *
   * The merchant landing screen's data source. `liveCounts` is deliberately `network:read` — it is
   * every tenant's picture at once — so calling it from a merchant console answers 403, and the list
   * endpoint cannot be counted because it is paginated.
   */
  async shipmentCounts(): Promise<ShipmentCounts> {
    const { data } = await this.request<ShipmentCounts>('/v1/shipments/counts', { method: 'GET' });
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
    identifier: string,
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
      body: { identifier, password, ...(merchantId ? { merchantId } : {}) },
    });
    return data as {
      token: string;
      expiresAt: string;
      tokenType: string;
      merchantId: string;
      merchantIds: ReadonlyArray<string>;
    };
  }

  /**
   * POST /v1/auth/token — sign in and receive the bearer token.
   *
   * For native and server-to-server clients only. `/v1/auth/login` sets an HttpOnly cookie and
   * deliberately leaves the token out of the response body, because a browser console's script can
   * read bodies — so an XSS would get the credential the cookie was there to protect. This endpoint
   * is the other half of the same session: same service call, same audit, same cost, token in the
   * body because a client with no browser has nowhere else to put it.
   */
  async loginToken(
    identifier: string,
    password: string,
    merchantId?: string,
  ): Promise<{
    token: string;
    tokenType: 'Bearer';
    expiresInSeconds: number;
    expiresAt: string;
    merchantId: string;
    merchantIds: ReadonlyArray<string>;
  }> {
    const { data } = await this.request('/v1/auth/token', {
      method: 'POST',
      body: { identifier, password, ...(merchantId ? { merchantId } : {}) },
    });
    return data as {
      token: string;
      tokenType: 'Bearer';
      expiresInSeconds: number;
      expiresAt: string;
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
    const resultUrl = `${this.options.baseUrl}/v1/shipments/bulk/${encodeURIComponent(jobId)}/result`;
    const [finalUrl, finalInit] = await this.withOnRequest(resultUrl, {
      method: 'GET',
      headers: this.headers(),
      credentials: this.options.credentials ?? 'same-origin',
    });
    const response = await this.fetchImpl(finalUrl, finalInit);
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
  ): Promise<RiderPullResult> {
    const { data } = await this.request<RiderPullResult>(
      `/v1/riders/${encodeURIComponent(riderId)}/sync`,
      {
        method: 'GET',
        query: options,
      },
    );
    return data;
  }

  /** POST /v1/riders/:riderId/sync/ack — acknowledge work executed. */
  async ackRiderSync(
    riderId: string,
    commandId: string,
    idempotencyKey: string,
  ): Promise<RiderAckResult> {
    const { data } = await this.request<RiderAckResult>(
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
  ): Promise<RiderReplayResult> {
    const { data } = await this.request<RiderReplayResult>(
      `/v1/riders/${encodeURIComponent(riderId)}/sync/replay`,
      {
        method: 'POST',
        body: { commands },
      },
    );
    return data;
  }

  /* ---------------------------------------------------------------- proof of delivery
   *
   * The recipient's confirmation, the photo, and where it happened. Two calls because they are
   * two moments: a code is minted at the door and read out seconds later.
   */

  /** POST /v1/deliveries/:id/proof/code — mint a code for the customer to read out. */
  async issueDeliveryCode(jobId: string): Promise<IssuedDeliveryCode> {
    const { data } = await this.request<IssuedDeliveryCode>(
      `/v1/deliveries/${encodeURIComponent(jobId)}/proof/code`,
      { method: 'POST' },
    );
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
  ): Promise<SubmittedDeliveryProof> {
    const { data } = await this.request<SubmittedDeliveryProof>(
      `/v1/deliveries/${encodeURIComponent(jobId)}/proof`,
      {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      },
    );
    return data;
  }

  /* ---------------------------------------------------------------- notification preferences */

  /**
   * GET /v1/notification-preferences — which parcel events this merchant's customers hear about.
   *
   * The server answers for every event, not only the stored ones, so the screen can show a toggle
   * per event and mark the ones still on their default.
   */
  async notificationPreferences(): Promise<readonly NotificationPreference[]> {
    const { data } = await this.request<readonly NotificationPreference[]>(
      '/v1/notification-preferences',
      { method: 'GET' },
    );
    return data;
  }

  /** PUT /v1/notification-preferences — opt one event out, or back in. */
  async setNotificationPreference(
    eventType: string,
    enabled: boolean,
  ): Promise<NotificationPreference> {
    const { data } = await this.request<NotificationPreference>('/v1/notification-preferences', {
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
  async listWebhooks(): Promise<readonly WebhookEndpoint[]> {
    const { data } = await this.request<readonly WebhookEndpoint[]>('/v1/webhooks', {
      method: 'GET',
    });
    return data;
  }

  /** POST /v1/webhooks — register a new webhook endpoint (returns secret once) */
  async createWebhook(
    body: components['schemas']['CreateWebhookDto'],
  ): Promise<CreatedWebhookEndpoint> {
    const { data } = await this.request<CreatedWebhookEndpoint>('/v1/webhooks', {
      method: 'POST',
      body,
    });
    return data;
  }

  /** GET /v1/webhooks/deliveries — delivery attempts log */
  async listWebhookDeliveries(options?: {
    endpointId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    readonly data: readonly WebhookDeliveryRow[];
    readonly nextCursor: string | null;
  }> {
    const { data } = await this.request<{
      data: readonly WebhookDeliveryRow[];
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
  async replayWebhookDelivery(deliveryId: string): Promise<{ readonly deliveryId: string }> {
    const { data } = await this.request<{ readonly deliveryId: string }>(
      `/v1/webhooks/deliveries/${encodeURIComponent(deliveryId)}/replay`,
      {
        method: 'POST',
        body: {},
      },
    );
    return data;
  }

  /** POST /v1/api-keys — mint a new merchant API key (secret returned once) */
  async createApiKey(body: { name: string; scopes: string[] }): Promise<CreatedApiKey> {
    const { data } = await this.request<CreatedApiKey>('/v1/api-keys', {
      method: 'POST',
      body,
    });
    return data;
  }

  /**
   * GET /v1/analytics/merchant — your own daily series: parcels and money.
   *
   * One point per day (Asia/Dhaka buckets). Money values are strings — poisha above
   * 2^53 would lose precision as JSON numbers. Both projection halves carry the
   * merchant id so the series is strictly scoped to the caller's account.
   */
  async merchantAnalytics(options?: {
    from?: string; // yyyy-mm-dd inclusive
    to?: string; // yyyy-mm-dd inclusive
  }): Promise<MerchantSeries> {
    const { data } = await this.request<MerchantSeries>('/v1/analytics/merchant', {
      method: 'GET',
      query: options,
    });
    return data;
  }
}
