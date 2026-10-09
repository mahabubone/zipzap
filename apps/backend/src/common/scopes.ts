/**
 * API scopes: a cross-cutting authorization vocabulary, not business logic.
 *
 * Lives in common/ because identity and merchant both need to name the same strings. If it lived
 * in either module's domain, the other would have to import across a module boundary to refer to
 * a permission — which is how "just import the enum" turns into coupling.
 */

export const API_SCOPES = [
  'shipments:read',
  'shipments:write',
  'tracking:read',
  // The hub console's own vocabulary, which arrived with the hub console. Until a principal existed
  // for it, `POST /v1/hubs/scans` was gated on `shipments:write` — so a HUB_OPERATOR could not scan
  // anything at all, and granting it would have let a hub terminal create and cancel shipments,
  // which is a merchant's power. The scan controller's own header predicted this: add the scope
  // when the principal arrives, not before.
  'hub:read',
  'hub:scan',
  // A rider's command queue is a day of somebody's work. A merchant is our client, not our network
  // partner — their staff have no business reading which parcel a named rider is holding, and the
  // queue also carries COD amounts. Platform, not tenant, so it is withheld from merchant roles.
  'rider:sync',
  'pickup:create',
  'pickup:read',
  'delivery:create',
  'delivery:read',
  'delivery:complete',
  'returns:read',
  'returns:write',
  'cod:read',
  'settlements:read',
  'settlements:approve',
  'webhooks:manage',
  'keys:manage',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}
