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
  // Which messages a merchant's customers get. Its own scope because it is a statement about
  // consent and cost, not about a parcel: reusing `shipments:write` would hand an operator who
  // creates shipments the power to silence every delivery notification the account sends.
  'notifications:manage',
  'keys:manage',
  // The network's own operational picture: every merchant's shipment counts, COD money in
  // poisha, return rates, hub volumes. `GET /v1/control-tower/report` and `.../live-counts` were
  // guarded by ApiKeyGuard alone, so a merchant API key read all of it — the guard authenticated
  // the caller and then the endpoint answered for every tenant. Same class as the rider queue in
  // migration `0042`: the scope was missing rather than merely unenforced.
  //
  // Platform, because it is the network and not one account. A merchant gets their own numbers
  // from `GET /v1/analytics/merchant`, which filters by the principal.
  'network:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}
