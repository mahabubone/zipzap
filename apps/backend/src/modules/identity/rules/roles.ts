/**
 * Role bundles: which scopes a HUMAN may hold. Framework-free, and the only place a role name
 * maps to anything.
 *
 * Guards check scopes, never role names (AGENTS.md rule: a guard that knows "MERCHANT_OWNER" is a
 * guard that breaks the day a role is renamed). A role is therefore just a named bundle of scopes,
 * and this file is the single source of the mapping.
 *
 * `ponytail:` roles are code, not rows. There is no `identity.roles` table, because a merchant
 * cannot invent a role and no admin UI manages them — a bundle that only ever comes from this file
 * needs no CRUD, no migration, and no cache. Add a table when an operator genuinely needs to
 * define a role at runtime; until then this is the whole model.
 *
 * The security-relevant decision is what MERCHANT_OPERATOR is *not* given. Two scopes are withheld
 * from it, and both are irreversible if abused:
 *
 *   - `settlements:approve` moves money out of the platform
 *   - `keys:manage` mints credentials that act with full merchant scope
 *
 * An operator who can do either is an operator who can empty the account. Every other merchant
 * scope is granted, because an operator who cannot see shipments cannot do their job.
 */

import { API_SCOPES, type ApiScope } from '../../../common/scopes.ts';

export const ROLE_NAMES = [
  'PLATFORM_ADMIN',
  'OPERATIONS_MANAGER',
  'HUB_OPERATOR',
  'SUPPORT_AGENT',
  'MERCHANT_OWNER',
  'MERCHANT_OPERATOR',
  'RIDER',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export function isRoleName(value: string): value is RoleName {
  return (ROLE_NAMES as readonly string[]).includes(value);
}

/** Everything a merchant-facing role may hold. Platform scopes are separate by construction. */
const MERCHANT_SCOPES: readonly ApiScope[] = [
  'shipments:read',
  'shipments:write',
  'tracking:read',
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
];

/** The two an operator may not hold. Named so the reason survives a future edit. */
export const OWNER_ONLY_SCOPES: readonly ApiScope[] = ['settlements:approve', 'keys:manage'];

function without(scp: readonly ApiScope[], drop: readonly ApiScope[]): readonly ApiScope[] {
  return scp.filter((s) => !drop.includes(s));
}

export const ROLE_SCOPES: Readonly<Record<RoleName, readonly ApiScope[]>> = {
  /** Platform staff. The only role that may act outside a merchant's tenancy. */
  PLATFORM_ADMIN: API_SCOPES,

  /**
   * Runs the network day to day: sees every merchant's shipments, moves parcels between hubs, and
   * releases holds. Not merchant money — an ops manager can see that a COD exists, not settle it.
   */
  OPERATIONS_MANAGER: [
    'shipments:read',
    'tracking:read',
    'pickup:read',
    'delivery:read',
    'delivery:complete',
    'returns:read',
    'returns:write',
    'cod:read',
  ],

  /** Works a hub: scans and reconciles manifests. Read-only elsewhere, and sees no money at all. */
  HUB_OPERATOR: ['shipments:read', 'tracking:read', 'pickup:read', 'delivery:read'],

  /**
   * Answers "where is my parcel". Read-only everywhere. Deliberately cannot read `cod:read`: a
   * support agent answering a delivery question has no reason to see a merchant's cash position,
   * and a read is the easiest permission to escalate from.
   */
  SUPPORT_AGENT: ['shipments:read', 'tracking:read', 'pickup:read', 'returns:read'],

  /** The merchant themselves. Every merchant scope, because they are the principal. */
  MERCHANT_OWNER: MERCHANT_SCOPES,

  /** Staff who operate the account day to day. Everything except the two owner-only scopes. */
  MERCHANT_OPERATOR: without(MERCHANT_SCOPES, OWNER_ONLY_SCOPES),

  /**
   * A rider's own feed. Not a merchant role at all — a rider is scoped to assigned jobs, which the
   * rider module enforces separately. These scopes are the floor the app needs to render work.
   */
  RIDER: ['tracking:read', 'pickup:read', 'delivery:read', 'delivery:complete'],
};

export function scopesForRole(role: RoleName): readonly ApiScope[] {
  return ROLE_SCOPES[role];
}
