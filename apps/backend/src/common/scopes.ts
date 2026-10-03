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
  'returns:write',
  'settlements:read',
  'webhooks:manage',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}
