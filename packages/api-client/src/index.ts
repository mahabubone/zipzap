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

/** GET /v1/me */
export interface Principal {
  readonly kind: 'human' | 'machine';
  readonly subjectId: string;
  readonly merchantId: string | null;
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
  readonly createdAt: string;
}

/** GET /v1/shipments/:id */
export interface ShipmentDetail extends ShipmentSummary {
  readonly senderName: string;
  readonly senderPhone: string;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly parcelWeightGrams: number;
  readonly parcelDescription: string;
  readonly pricingVersion: number;
}

/** POST /v1/shipments */
export interface CreatedShipment {
  readonly id: string;
  readonly trackingCode: string;
  readonly status: string;
  readonly createdAt: string;
  readonly replayed: boolean;
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

/** GET /v1/control-tower/live-counts. Money arrives as a decimal string — the
 *  controller serialises bigint there; see its comment for why. */
export interface LiveCounts {
  readonly timestamp: string;
  readonly shipments: Readonly<Record<string, number | Readonly<Record<string, number>>>>;
  readonly pickups: Readonly<Record<string, number | Readonly<Record<string, number>>>>;
  readonly deliveries: Readonly<Record<string, number | Readonly<Record<string, number>>>>;
  readonly cod: Readonly<
    Record<string, number | string | Readonly<Record<string, number>>>
  > & { readonly outstandingAmountMinor: string };
  readonly riders: Readonly<Record<string, number | Readonly<Record<string, number>>>>;
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

export class ZipZapClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
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

  /** GET /v1/shipments — cursor-paginated, newest first. */
  async listShipments(query?: ListQuery): Promise<Page<ShipmentSummary>> {
    const { data } = await this.request<{
      data: ShipmentSummary[];
      pagination: { next_cursor: string | null; has_more: boolean };
    }>('/v1/shipments', { method: 'GET', query: query as Record<string, string | undefined> });
    return {
      data: data.data,
      nextCursor: data.pagination.next_cursor,
      hasMore: data.pagination.has_more,
    };
  }

  /** GET /v1/shipments/:id — one of your shipments. */
  async getShipment(id: string): Promise<ShipmentDetail> {
    const { data } = await this.request<ShipmentDetail>(
      `/v1/shipments/${encodeURIComponent(id)}`,
      { method: 'GET' },
    );
    return data;
  }

  /** GET /v1/control-tower/live-counts — the control tower snapshot. */
  async liveCounts(): Promise<LiveCounts> {
    const { data } = await this.request<LiveCounts>('/v1/control-tower/live-counts', { method: 'GET' });
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

  /** POST /v1/auth/login — email + scrypt password → 12h bearer session. */
  async login(
    email: string,
    password: string,
  ): Promise<{ token: string; expiresAt: string; tokenType: string }> {
    const { data } = await this.request('/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    return data as { token: string; expiresAt: string; tokenType: string };
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
}
