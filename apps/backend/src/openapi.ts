/**
 * The single place the OpenAPI document is built.
 *
 * Before this, `main.ts` and `scripts/export-openapi.mjs` each built their own — and they were not
 * the same document. The export script added `ApiKey` as a security scheme, `main.ts` did not, so
 * the committed `openapi.json` disagreed with the live `/docs-json` on
 * `components.securitySchemes`. A spec that differs from the server it describes is worse than no
 * spec, because the generated client is built from it. One builder, two callers, one document.
 *
 * `export-openapi.mjs` imports this from `dist/`, so it must stay free of anything only the running
 * server has.
 */

import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
  type TagObject,
} from '@nestjs/swagger';
import { ApiKeyGuard, ScopeGuard } from './modules/identity/api-key.guard.ts';
import { RateLimitGuard } from './modules/identity/rate-limit.guard.ts';

/**
 * Tags carry descriptions because the names alone do not say what a resource is for.
 * `ApiTags` supplies the name per controller; these supply the prose.
 *
 * Keys are the literal `@ApiTags` values used in controllers, not the module names: `auth`, not
 * `identity`. The spec test asserts this map is exactly the set of tags the controllers use, in
 * both directions — a stale entry is a lie about the API and a missing one is an undocumented
 * resource, so neither is tolerable and the test fails either way.
 */
export const TAG_DESCRIPTIONS: Record<string, string> = {
  analytics: 'Read-only projections of your own parcels and money.',
  'api-keys': 'Long-lived machine credentials for your account.',
  members:
    'Who may act inside this business, and as what. The business is named in the path, never the body.',
  auth: 'Sessions: sign in with email and password, and back out again.',
  cod: 'Cash-on-delivery records, exceptions and reconciliation.',
  'control-tower': 'The network-wide operational picture.',
  coverage: 'Serviceable postcodes and their zones.',
  deliveries: 'Delivery jobs, attempts and proof of delivery.',
  health: 'Liveness and readiness probes.',
  hubs: 'Hub inventory and the scan-first dock console.',
  identity: 'The authenticated principal.',
  manifests: 'Manifests and the line-haul trips that carry them.',
  notifications: 'Which messages your customers receive, on which channel.',
  pickups: 'Pickup requests and rider assignment.',
  pricing: 'Quotes and the rate card they are drawn from.',
  returns: 'Return requests and their decisions.',
  riders: 'Rider registration, positions, utilisation and the offline command queue.',
  settlements: 'Settlements, statements and your balance.',
  shipments: 'Shipment lifecycle: create, quote, track, hold, release, cancel.',
  tracking: 'Public, credential-free parcel tracking by code.',
  webhooks: 'Outbound webhook endpoints, delivery log and replay.',
};

/** Security scheme names. */
const SCHEME_API_KEY = 'ApiKey';
const SCHEME_SESSION_COOKIE = 'SessionCookie';

/**
 * The outbound webhook event catalogue, as the wire spells it.
 *
 * These are a *public* contract with their own naming and their own stability guarantees, which is
 * why they are not simply the internal event names: `ShipmentDelivered` leaves the building as
 * `shipment.delivered`. A receiver hard-codes these strings, so an addition is additive only.
 *
 * Surfaced as `x-webhook-events` on the tag so the spec is self-contained for a receiver building an
 * integration — without it, the catalogue lives only in prose in `docs/api/webhooks.md` and a client
 * generated from this document has no way to know what can arrive.
 */
export const WEBHOOK_EVENTS = [
  'shipment.created',
  'shipment.picked_up',
  'shipment.in_transit',
  'shipment.out_for_delivery',
  'shipment.delivered',
  'shipment.delivery_failed',
  'shipment.return_initiated',
  'shipment.returned',
  'cod.collected',
  'settlement.created',
  'settlement.completed',
] as const;

/**
 * The headers a receiver must verify, and the delivery contract they carry.
 *
 * Also an `x-` extension on the tag. `@ApiParam`/`@ApiHeader` describe requests *into* this API;
 * webhooks are requests *out of* it, so nothing in the operation schema can express them.
 */
const WEBHOOK_HEADERS = {
  'ZipZap-Signature':
    't=<unix-seconds>,v1=<hmac-sha256 hex>. HMAC-SHA256 over `{timestamp}.{raw_body}` with the ' +
    'endpoint signing secret. Compare in constant time, against the bytes exactly as they arrived ' +
    '— before parsing, and before re-serialising, since field order and number formatting are both ' +
    'part of the signed string.',
  'ZipZap-Delivery': 'Delivery id. Deduplicate on it.',
  'ZipZap-Event': 'The event type, from the `x-webhook-events` catalogue.',
  'ZipZap-Attempt': '1-based attempt number. Drives the retry ladder below.',
} as const;

/** The rate-limit facts a route is subject to, read off its guard. */
interface RateLimitFacts {
  readonly tier: string;
  readonly failClosed: boolean;
}

interface GuardHooks {
  /** `ScopeGuard`'s constructor param, which TypeScript names `required`. */
  readonly required: string;
}

interface TaggedOperation {
  readonly path: string;
  readonly method: string;
  readonly operation: Record<string, unknown>;
}

function iterateOperations(paths: OpenAPIObject['paths']): TaggedOperation[] {
  const out: TaggedOperation[] = [];
  for (const [path, item] of Object.entries(paths ?? {})) {
    if (!item || typeof item !== 'object') continue;
    for (const [method, operation] of Object.entries(item as Record<string, unknown>)) {
      if (!operation || typeof operation !== 'object') continue;
      out.push({ path, method, operation: operation as Record<string, unknown> });
    }
  }
  return out;
}

/** Guard instances are created at the decorator site, so `private` fields are still readable. */
function hookOf(guard: unknown): GuardHooks | undefined {
  if (guard instanceof ScopeGuard) {
    return { required: (guard as unknown as { required: string }).required };
  }
  return undefined;
}

function rateLimitFactsOf(guard: unknown): RateLimitFacts | undefined {
  if (guard instanceof RateLimitGuard) {
    return {
      tier: (guard as unknown as { tier: string }).tier,
      failClosed: (guard as unknown as { failClosed: boolean }).failClosed,
    };
  }
  return undefined;
}

function hasApiKeyGuard(guards: readonly unknown[]): boolean {
  return guards.some((guard) => guard === ApiKeyGuard);
}

/**
 * Attach what each route requires, read from its guards.
 *
 * This is deliberately *not* a second decorator. The temptation is to add `@ApiScope('x')` next to
 * `new ScopeGuard('x')`, which reads nicely and then silently rots: the guard enforces one scope,
 * the decorator documents another, and nothing notices. So the scope is read from the guard
 * instance itself — the same object Nest will call — and there is no second copy to drift.
 *
 * Guards are attached with `@UseGuards`, at class level for authentication and at method level for
 * scope and rate limiting. Nest stores both under `GUARDS_METADATA`, on the class and on the
 * handler respectively.
 *
 * Operations are matched to controllers by `operationId` (`<ControllerName>_<methodName>`), which
 * is how `@nestjs/swagger` derives it. A controller or handler that cannot be matched would mean an
 * undocumented route, so it is counted and reported rather than skipped quietly.
 */
function attachRouteRequirements(document: OpenAPIObject, app: INestApplication): void {
  const container = (app as unknown as { container?: unknown }).container;
  const modules = (
    container as { getModules?: () => Map<string, unknown> } | undefined
  )?.getModules?.();
  if (!modules) return;

  interface ControllerInfo {
    readonly prototype: object;
    readonly requiresAuth: boolean;
  }
  const controllers = new Map<string, ControllerInfo>();

  for (const moduleRef of modules.values()) {
    const moduleControllers = (
      moduleRef as {
        controllers?: Map<unknown, { metatype?: { name?: string; prototype?: object } }>;
      }
    ).controllers;
    if (!moduleControllers) continue;
    for (const wrapper of moduleControllers.values()) {
      const metatype = wrapper?.metatype;
      if (!metatype?.name || !metatype.prototype) continue;
      const classGuards = Reflect.getMetadata(GUARDS_METADATA, metatype) as unknown[] | undefined;
      controllers.set(metatype.name, {
        prototype: metatype.prototype,
        requiresAuth: hasApiKeyGuard(classGuards ?? []),
      });
    }
  }

  for (const { operation } of iterateOperations(document.paths)) {
    const operationId = operation.operationId as string | undefined;
    if (!operationId) continue;
    const separator = operationId.lastIndexOf('_');
    if (separator < 1) continue;
    const controller = controllers.get(operationId.slice(0, separator));
    if (!controller) continue;
    const handler = (controller.prototype as Record<string, unknown>)[
      operationId.slice(separator + 1)
    ];
    if (typeof handler !== 'function') continue;

    const methodGuards =
      (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [];

    const scopes = methodGuards
      .map(hookOf)
      .filter((facts): facts is GuardHooks => facts !== undefined)
      .map((facts) => facts.required);
    if (scopes.length > 0) {
      operation['x-required-scopes'] = [...scopes].sort();
      // A guarded endpoint takes either credential form: a bearer session or an ApiKey principal
      // on the Authorization header, or the HttpOnly cookie a browser already holds. `security`
      // is a list of OR alternatives, which is what the server actually does.
      operation.security = [{ [SCHEME_API_KEY]: [] }, { [SCHEME_SESSION_COOKIE]: [] }];
    } else if (controller.requiresAuth) {
      // Authenticated but not scoped: the controller-level guard applies.
      operation.security = [{ [SCHEME_API_KEY]: [] }, { [SCHEME_SESSION_COOKIE]: [] }];
    }

    const rateLimit = methodGuards
      .map(rateLimitFactsOf)
      .filter((facts): facts is RateLimitFacts => facts !== undefined);
    if (rateLimit.length > 0) {
      operation['x-rate-limit'] = rateLimit.map((facts) => ({
        tier: facts.tier,
        // `failClosed` is a load-handling decision, not a security one: a mutation refuses on a
        // Redis outage so a dead limit cannot flood the database, while a read opens so a Redis
        // outage does not also take tracking down.
        failClosed: facts.failClosed,
      }));
    }
  }
}

export function buildDocument(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ZipZap API')
      .setDescription(
        [
          'Logistics operating system for e-commerce fulfillment and last-mile delivery.',
          '',
          'Models a real courier business end to end: order, pricing, pickup,',
          'origin hub, line-haul, destination hub, last-mile, COD, settlement.',
          '',
          '## Credentials',
          '',
          'Every `/v1` endpoint except `auth/login` and the public `/track` routes needs a',
          'credential. Two forms work on the same `Authorization` header:',
          '',
          '- `Authorization: Bearer <session-token>` — a session from `POST /v1/auth/login`.',
          '- `Authorization: ApiKey <key-id>.<secret>` — a machine principal.',
          '',
          'A browser signed in through a ZipZap console sends `Cookie: zipzap_session=<token>`',
          'instead; see `docs/api/auth.md`.',
          '',
          '## What an operation requires',
          '',
          '`x-required-scopes` lists the scope(s) the operation enforces, taken from its own',
          '`ScopeGuard` rather than restated by hand. `x-rate-limit` names the bucket it draws from',
          'and whether that bucket closes or opens when Redis is unreachable.',
          '',
          '## Errors',
          '',
          'Every failure is the §87 envelope described by `ErrorEnvelopeDto`: `type`, `title`,',
          '`status`, `code`, `detail`, `request_id`. Switch on `code`; `title` and `detail` are',
          'prose and may be reworded. Nothing else is ever returned as an error body.',
          '',
          '## Money',
          '',
          'Integer minor units (poisha) plus a currency. Per-row amounts are JSON numbers with',
          '`type: integer`; aggregates are decimal strings, because a sum can exceed what a JSON',
          'number represents exactly. Never a float — see `docs/ADR/0009-money-representation.md`.',
          '',
          '## Idempotency',
          '',
          'Mutations listed in `docs/api/idempotency.md` require an `Idempotency-Key` header.',
          'Replaying the same key returns the original result rather than applying the mutation',
          'twice.',
        ].join('\n'),
      )
      .setVersion('1.0')
      // The web apps proxy /api to this server, so same-origin is the normal deployment.
      .addServer('/', 'Same origin — the web apps proxy /api here.')
      .addApiKey(
        {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header',
          description:
            'Bearer <session-token> or ApiKey <key-id>.<secret>. Same header, two principal kinds.',
        },
        SCHEME_API_KEY,
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'zipzap_session',
          in: 'cookie',
          description:
            'HttpOnly session cookie set by POST /v1/auth/login. Browsers signed in to a console.',
        },
        SCHEME_SESSION_COOKIE,
      )
      .addBearerAuth()
      .build(),
  );

  for (const [name, description] of Object.entries(TAG_DESCRIPTIONS)) {
    const tag: Record<string, unknown> = { name, description };
    // The webhook tag carries the wire contract too: nothing in an operation schema can describe a
    // request we send out, and a receiver building an integration from this document alone must not
    // have to guess the header names or the event vocabulary.
    if (name === 'webhooks') {
      tag['x-webhook-events'] = [...WEBHOOK_EVENTS];
      tag['x-webhook-headers'] = WEBHOOK_HEADERS;
      tag['x-webhook-retries'] =
        '1m → 5m → 15m → 1h → 6h → 24h, then terminal. Timeout, connection refused, 5xx and 429 ' +
        '(honouring Retry-After) all retry; any other 4xx does not, because the payload will not ' +
        'become valid by being sent again.';
    }
    (document.tags ??= []).push(tag as unknown as TagObject);
  }
  // Sorted, or the file churns on every regeneration: the controller discovery order is not
  // stable across builds.
  document.tags = (document.tags ?? []).sort((a, b) => a.name.localeCompare(b.name));

  attachRouteRequirements(document, app);

  return document;
}
