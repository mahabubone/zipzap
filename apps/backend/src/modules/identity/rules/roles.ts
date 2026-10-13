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
 *
 * ## The vocabulary is no longer all merchant-facing
 *
 * `hub:read` and `hub:scan` arrived with the hub console, and they are not merchant powers: a
 * merchant does not stand at a conveyor belt. Granting them to a merchant would hand every
 * merchant API key the ability to drive the network state machine for a parcel they do not own —
 * `hub:scan` advances a shipment through custody, and that is platform state, not tenant state.
 *
 * So the split is now DERIVED rather than asserted: `MERCHANT_SCOPES` is every scope that is not
 * platform-facing, and a platform scope is withheld from merchants by default. That direction
 * matters. The previous shape listed the merchant's scopes explicitly, which meant the next scope
 * anyone added was a merchant scope until somebody remembered to subtract it — fail-open on a
 * permission list. A platform scope added tomorrow is withheld from every merchant role the moment
 * it lands here, with no second edit to forget.
 */

import { API_SCOPES, type ApiScope } from '../../../common/scopes.ts';

export const ROLE_NAMES = [
  'PLATFORM_ADMIN',
  'OPERATIONS_MANAGER',
  'HUB_MANAGER',
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

/**
 * Scopes that act on the network rather than on one merchant's account.
 *
 * Exported because the exclusion is a security claim that belongs in a test, and a test that has to
 * re-derive the list is a test that stops asserting anything the moment the list moves.
 */
/**
 * Scopes that belong to the delivery network rather than to any client of it.
 *
 * A hub is a network partner and a merchant is a client; neither is a tenant of the other, so
 * neither holds these. `hub:read`/`hub:scan` drive custody; `rider:sync` reads a rider's day. All
 * three would let a client drive or observe the network itself.
 */
export const PLATFORM_SCOPES: readonly ApiScope[] = [
  'hub:read',
  'hub:scan',
  'hub:manage',
  'rider:sync',
  'network:read',
];

/** Everything a merchant-facing role may hold: the vocabulary minus the platform's own. */
export const MERCHANT_SCOPES: readonly ApiScope[] = API_SCOPES.filter(
  (scope) => !PLATFORM_SCOPES.includes(scope),
);

/**
 * The scopes that are not merely merchant-facing but irreversible if abused.
 *
 * `settlements:approve` moves money out; `keys:manage` mints a credential that acts with full
 * merchant scope; `members:manage` hands out both by enrolling a person. A holder of any of the three
 * can grant themselves the others, so an operator holding one is effectively an owner — which is why
 * all three stop at the owner.
 */
export const OWNER_ONLY_SCOPES: readonly ApiScope[] = [
  'settlements:approve',
  'keys:manage',
  'members:manage',
];

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
    'hub:read',
    'hub:scan',
    'rider:sync',
    // The control tower is this role's screen. Without it the ops console's own two endpoints
    // answer 403 to the people who run the network.
    'network:read',
  ],

  /**
   * Runs one hub. Everything a HUB_OPERATOR can do, plus `hub:manage` — assign and revoke staff
   * at the hub, approve discrepancies, view capacity. The extra scope is the whole point of the
   * role: a line operator cannot enrol or revoke the person standing next to them.
   *
   * Hub assignment (which hub a manager runs) is enforced by the `hub.staff` table, not by
   * scopes — a scope says what kind of thing you may do; the assignment says at which hub.
   */
  HUB_MANAGER: [
    'shipments:read',
    'tracking:read',
    'pickup:read',
    'delivery:read',
    'hub:read',
    'hub:scan',
    'hub:manage',
  ],

  /**
   * Works a hub: scans parcels and reconciles manifests. Read-only elsewhere, and sees no money.
   *
   * `hub:scan` is deliberately NOT `shipments:write`. A hub operator moves parcels between hubs;
   * creating and cancelling shipments is the merchant's power, and a hub console that could do it
   * would turn every hub terminal into a way to write into someone else's account.
   */
  HUB_OPERATOR: [
    'shipments:read',
    'tracking:read',
    'pickup:read',
    'delivery:read',
    'hub:read',
    'hub:scan',
  ],

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
  /**
   * A rider's own day. `rider:sync` is the offline protocol: pull what ops queued, push back what
   * the rider did while the network was down, and acknowledge. It is the only way to move a
   * shipment forward for this role, which is the point — a rider app with no `rider:sync` could
   * read its jobs and never report anything.
   */
  RIDER: ['tracking:read', 'pickup:read', 'delivery:read', 'delivery:complete', 'rider:sync'],
};

export function scopesForRole(role: RoleName): readonly ApiScope[] {
  return ROLE_SCOPES[role];
}
