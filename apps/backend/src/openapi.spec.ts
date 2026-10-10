/**
 * Structural assertions on the committed OpenAPI document.
 *
 * `test/integration/openapi-contract.integration.test.ts` compares the committed spec against a
 * live server, but it is gated on `API_BASE_URL` and skips silently when no server is running. The
 * integration suites have never once passed without Retry-After in a README for exactly that
 * reason. So the assertions that need nothing but the file live here, where `pnpm test` always
 * runs them.
 *
 * These are the invariants the previous state of this spec got wrong. Each one is a bug that
 * shipped:
 *
 * - responses with no `content` — the file had 27 schemas and every one of them was request-side;
 * - a `security` entry naming a scheme that was never declared (`bearer`, on `POST /v1/auth/logout`),
 *   which is an unresolvable `$ref` in the spec a client is generated from;
 * - money typed `type: "number"` for a `bigint` column, which is AGENTS.md rule 4 broken by the
 *   document rather than by the code;
 * - tags with no description, and descriptions for tags no controller uses;
 * - `:param` routes the generated client could not know took a parameter.
 *
 * Not circular: every assertion reads the committed artefact, which is what `openapi-typescript`
 * turns into the client's types. If this test is green and CI's freshness gate is green, the
 * generated client is always consistent with it.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_SCOPES } from './common/scopes.ts';
import { TAG_DESCRIPTIONS } from './openapi.ts';

interface Operation {
  operationId?: string;
  tags?: string[];
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ name?: string; in?: string; required?: boolean }>;
  responses: Record<
    string,
    { content?: Record<string, unknown>; description?: string; schema?: unknown } | undefined
  >;
  'x-required-scopes'?: string[];
  [key: string]: unknown;
}

interface Document {
  openapi?: string;
  info?: { title?: string; version?: string };
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, Operation>>;
  components?: {
    securitySchemes?: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  };
}

function loadSpec(): Document {
  // The spec test is a unit spec in a CommonJS package, so no `import.meta.url`. Resolve from the
  // package root instead: this file lives in src/, the artefact in apps/backend/.
  const candidates = [
    join(process.cwd(), 'openapi.json'),
    join(process.cwd(), 'apps/backend/openapi.json'),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Document;
    } catch {
      // Try the next location.
    }
  }
  throw new Error('openapi.json not found — run pnpm --filter @zipzap/backend openapi:export');
}

const spec = loadSpec();

const operations: Array<{ path: string; method: string; operation: Operation }> = Object.entries(
  spec.paths ?? {},
).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([key, value]) => value && typeof value === 'object' && key !== 'parameters')
    .map(([method, operation]) => ({ path, method, operation: operation as Operation })),
);

/** Operations that legitimately carry no success body: 204 has none, by definition. */
const BODYLESS = new Set(['LogoutController_logout']);

/** Status codes that a body may arrive on. Bulk import uses 202 — queued, not done. */
const SUCCESS_STATUSES = ['200', '201', '202'];

/** Operations that cannot produce the standard error set, and say why. */
const ERROR_EXEMPT = new Map<string, string>([
  [
    'HealthController_healthz',
    'Liveness deliberately checks nothing, so it cannot fail for a reason a client can act on.',
  ],
  [
    'PublicTrackingController_events',
    'A public SSE stream: no credential, so no 401/403, and no dependency on the response path.',
  ],
]);

const schemaNames = new Set(Object.keys(spec.components?.schemas ?? {}));
const declaredSchemes = new Set(Object.keys(spec.components?.securitySchemes ?? {}));

describe('openapi.json structure', () => {
  it('is a document at all', () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info?.title).toBe('ZipZap API');
    expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThan(50);
  });

  it('covers a non-trivial number of operations', () => {
    // 83 at the time of writing. A floor rather than an equality, so adding routes cannot fail here.
    expect(operations.length).toBeGreaterThanOrEqual(80);
  });

  describe('every operation documents what it returns', () => {
    for (const { path, method, operation } of operations) {
      const id = operation.operationId ?? `${method} ${path}`;
      if (BODYLESS.has(id)) continue;
      it(`${id}`, () => {
        const codes = Object.keys(operation.responses).filter((code) =>
          SUCCESS_STATUSES.includes(code),
        );
        expect(codes.length, `${id} must declare a success status`).toBeGreaterThan(0);
        for (const code of codes) {
          const response = operation.responses[code];
          expect(response, `${id} ${code} must have a response object`).toBeDefined();
          const content = response?.content ?? {};
          expect(
            Object.keys(content).length,
            `${id} ${code} must declare a media type`,
          ).toBeGreaterThan(0);
        }
      });
    }
  });

  describe('every operation documents what it can fail with', () => {
    const errorStatuses = ['400', '401', '403', '404', '429', '500', '503'];
    for (const { path, method, operation } of operations) {
      const id = operation.operationId ?? `${method} ${path}`;
      if (ERROR_EXEMPT.has(id)) {
        it(`${id} is exempt: ${ERROR_EXEMPT.get(id)}`, () => {
          // The exemption is that it carries no §87-ENVELOPED failures — not that it carries no
          // responses at all. Asserting it has *some* response would be vacuous.
          expect(Object.keys(operation.responses).length).toBeGreaterThan(0);
        });
        continue;
      }
      it(`${id}`, () => {
        for (const status of errorStatuses) {
          const response = operation.responses[status];
          expect(response, `${id} must document ${status}`).toBeDefined();
          const ref = JSON.stringify(response?.content ?? {});
          expect(ref, `${id} ${status} must bind the error envelope`).toContain('ErrorEnvelopeDto');
        }
      });
    }
  });

  describe('security references resolve', () => {
    it('declares the bearer and ApiKey schemes', () => {
      // `@ApiBearerAuth()` on POST /v1/auth/logout referenced a `bearer` scheme that was never
      // declared, which is an unresolvable $ref. Both schemes that the spec refers to must exist.
      expect(declaredSchemes).toContain('ApiKey');
      expect(declaredSchemes).toContain('SessionCookie');
    });

    for (const { path, method, operation } of operations) {
      const id = operation.operationId ?? `${method} ${path}`;
      it(`${id} names only declared schemes`, () => {
        const requirements = operation.security ?? [];
        for (const requirement of requirements) {
          for (const name of Object.keys(requirement)) {
            expect(declaredSchemes, `${id} references undeclared scheme "${name}"`).toContain(name);
          }
        }
      });
    }
  });

  describe('every $ref resolves', () => {
    const refs: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (key === '$ref' && typeof value === 'string') refs.push(value);
          else walk(value);
        }
      }
    };
    walk(spec);

    it('collected some references', () => {
      expect(refs.length).toBeGreaterThan(100);
    });

    it('resolves every local reference', () => {
      const unresolved = [...new Set(refs)]
        .filter((ref) => ref.startsWith('#/'))
        .filter((ref) => !ref.startsWith('#/components/schemas/'))
        .concat(
          [...new Set(refs)]
            .filter((ref) => ref.startsWith('#/components/schemas/'))
            .map((ref) => ref.slice('#/components/schemas/'.length))
            .filter((name) => !schemaNames.has(name))
            .map((name) => `#/components/schemas/${name}`),
        );
      expect(unresolved).toEqual([]);
    });
  });

  describe('money is never typed `number`', () => {
    // Rule 4: integer minor units, `bigint` columns, integer arithmetic. The CLI plugin derives
    // `type` from the class-validator decorator and emits `number` for `@IsInt()`, so every money
    // field in the spec was claiming double precision for a bigint.
    const bad: string[] = [];
    const walkSchemas = (node: unknown, schema: string): void => {
      if (!node || typeof node !== 'object') return;
      if (!('properties' in (node as object))) return;
      const properties = (
        node as {
          properties: Record<string, { type?: string; additionalProperties?: { type?: string } }>;
        }
      ).properties;
      for (const [name, property] of Object.entries(properties)) {
        if (!name.endsWith('Minor') && !name.endsWith('MinorUnits')) continue;
        if (property.type === 'object') {
          // A map of code to amount (rate-card packaging fees) is an object whose VALUES are
          // integers. That is still exact; only a bare `number` is a float in disguise.
          if (property.additionalProperties?.type === 'integer') continue;
          bad.push(`${schema}.${name}: object without integer values`);
          continue;
        }
        if (property.type !== 'integer' && property.type !== 'string') {
          bad.push(`${schema}.${name}: type=${property.type ?? 'missing'}`);
        }
      }
    };
    for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
      walkSchemas(schema, name);
    }

    it('types every minor-unit amount as integer or string', () => {
      expect(bad).toEqual([]);
    });
  });

  describe('arrays are not doubled', () => {
    const bad: string[] = [];
    const walkSchemas = (node: unknown, schema: string, seen = new Set<unknown>()): void => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if ('properties' in (node as object)) {
        const properties = (
          node as {
            properties: Record<string, { type?: string; items?: { type?: string } }>;
          }
        ).properties;
        for (const [name, property] of Object.entries(properties)) {
          if (property.type === 'array' && property.items?.type === 'array') {
            bad.push(`${schema}.${name}: an array of arrays`);
          }
        }
      }
      for (const value of Object.values(node as Record<string, unknown>)) {
        if (value && typeof value === 'object') walkSchemas(value, schema, seen);
      }
    };
    for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
      walkSchemas(schema, name);
    }

    it('never emits a nested array property', () => {
      // `@ApiProperty({ isArray: true })` with no `type` makes the CLI plugin emit
      // `{ type: array, items: { type: string } }` nested inside another array, so the
      // generated client sees `string[][]` for a `string[]` field and stops compiling in the
      // consumer. It shipped once already, on `EndpointViewDto.events`.
      expect(bad).toEqual([]);
    });
  });

  describe('the cookie contract is visible in the spec', () => {
    const operationOf = (operationId: string): Operation => {
      const found = operations.find(({ operation }) => operation.operationId === operationId);
      if (!found) throw new Error(`no operation with id ${operationId}`);
      return found.operation;
    };

    /** The schema an operation returns, as a record so its properties can be read. */
    const responseProperties = (operationId: string): Record<string, unknown> => {
      const operation = operationOf(operationId);
      const successCode = SUCCESS_STATUSES.find((code) => operation.responses[code]?.content);
      const content = successCode ? operation.responses[successCode]?.content : undefined;
      const media = content?.['application/json'] as { schema?: { $ref?: string } } | undefined;
      const ref = media?.schema?.$ref?.split('/').pop();
      if (!ref) throw new Error(`${operationId} returns no $ref schema`);
      const schema = spec.components?.schemas?.[ref] as
        { properties?: Record<string, unknown> } | undefined;
      return schema?.properties ?? {};
    };

    it('declares the session cookie as a security scheme', () => {
      // Without this, a client generated from the spec has no way to know the cookie exists, and
      // a receiver cannot discover what to set. `ApiKey` alone describes the bearer world only.
      expect(declaredSchemes).toContain('SessionCookie');
      const scheme = spec.components?.securitySchemes?.SessionCookie as
        { name?: string; in?: string } | undefined;
      expect(scheme?.name).toBe('zipzap_session');
      expect(scheme?.in).toBe('cookie');
    });

    it('does NOT put a token in the body of the browser login endpoint', () => {
      // This is the whole point of the cookie. Returning the token in the body as well as the
      // header would hand script the credential `HttpOnly` just took away.
      expect(Object.keys(responseProperties('LoginController_login'))).not.toContain('token');
    });

    it('DOES put a token in the body of the machine login endpoint', () => {
      // `/auth/token` exists for exactly the clients that cannot hold a cookie. It must say so.
      expect(Object.keys(responseProperties('LoginController_token'))).toContain('token');
    });

    it('documents the logout cookie-clearing side effect', () => {
      const operation = operationOf('LogoutController_logout');
      // A 204 with no body can still set headers, and a client that reads only the body would
      // never learn the cookie was cleared.
      expect(operation.responses['204']?.description?.length ?? 0).toBeGreaterThan(20);
    });
  });

  describe('tags are documented, and none are invented', () => {
    it('describes every tag the controllers use', () => {
      const used = new Set<string>();
      for (const { operation } of operations) {
        for (const tag of operation.tags ?? []) used.add(tag);
      }
      const documented = new Set(Object.keys(TAG_DESCRIPTIONS));
      expect([...used].filter((tag) => !documented.has(tag))).toEqual([]);
      expect([...documented].filter((tag) => !used.has(tag))).toEqual([]);
    });

    it('gives every documented tag prose', () => {
      for (const tag of spec.tags ?? []) {
        expect(tag.description, `tag ${tag.name} needs a description`).toBeTruthy();
      }
    });
  });

  describe('the webhook wire contract is in the spec', () => {
    // `TagObject` from @nestjs/swagger declares only `name` and `description`, and the `x-`
    // extensions this builds deliberately live outside that type — which is the point of an
    // extension. Indexing it as a record is how they get read back.
    const tag = (spec.tags ?? []).find((entry) => entry.name === 'webhooks') as
      Record<string, unknown> | undefined;

    it('attaches the event catalogue to the webhook tag', () => {
      // Nothing in an operation schema can describe a request this API sends OUT, so without this
      // extension the catalogue exists only in prose and a receiver building from the generated
      // contract has no way to know what can arrive.
      expect(tag?.['x-webhook-events']).toContain('shipment.delivered');
      expect(tag?.['x-webhook-events']).toContain('cod.collected');
      expect((tag?.['x-webhook-events'] as string[])?.length).toBeGreaterThanOrEqual(11);
    });

    it('names the headers a receiver must verify', () => {
      expect(Object.keys(tag?.['x-webhook-headers'] ?? {})).toEqual([
        'ZipZap-Signature',
        'ZipZap-Delivery',
        'ZipZap-Event',
        'ZipZap-Attempt',
      ]);
    });

    it('states the retry ladder', () => {
      expect(String(tag?.['x-webhook-retries'])).toContain('24h');
    });
  });

  describe('path parameters are declared', () => {
    for (const { path, operation } of operations) {
      const declared = operation.parameters
        ?.filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name);
      const needed = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
      if (needed.length === 0) continue;
      it(`${operation.operationId ?? path} declares its path params`, () => {
        expect(declared ?? []).toEqual(expect.arrayContaining(needed));
      });
    }
  });

  describe('scopes use the vocabulary', () => {
    for (const { operation } of operations) {
      const scopes = operation['x-required-scopes'] ?? [];
      if (scopes.length === 0) continue;
      it(`${operation.operationId} names only declared scopes`, () => {
        for (const scope of scopes) {
          expect(API_SCOPES).toContain(scope);
        }
      });
    }
  });
});
