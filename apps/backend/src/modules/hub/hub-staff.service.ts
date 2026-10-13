import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError, ValidationFailedError } from '../../common/domain-error.ts';
import { UserService } from '../identity/user.service.ts';
import { hasScope, type ApiPrincipal } from '../identity/rules/api-principal.ts';
import {
  HubRepository,
  type HubStaffRole,
  type StaffedHubRow,
  type StaffRow,
} from './hub.repository.ts';

/**
 * HubStaffService — assign, list, and revoke staff at a hub.
 *
 * Hub assignment answers a different question than scopes. A scope says what KIND of thing you may
 * do (scan parcels, manage staff); an assignment says AT WHICH HUB. A HUB_MANAGER without an
 * assignment can manage nothing, and a HUB_OPERATOR assigned to DHK-01 cannot scan at DHK-02.
 *
 * The one-active-hub-per-person rule is enforced by the partial unique index on `hub.staff`, not by
 * code here — a race between two managers inserting for the same user still produces one row.
 *
 * Cross-schema boundary: this module owns `hub.staff` and may read `hub.hubs` (same schema). It may
 * NOT read `identity.users`. To verify that a user exists before assigning them, it calls
 * `UserService`, which identity exports — the same seam `MembershipService` uses for the reverse
 * direction.
 */
@Injectable()
export class HubStaffService {
  constructor(
    @InjectDataSource('hub') private readonly hub: DataSource,
    @Inject(HubRepository) private readonly repo: HubRepository,
    @Inject(UserService) private readonly users: UserService,
  ) {}

  /**
   * The hub the caller is assigned to, or null.
   *
   * Null is the "between hubs" state, not an error — the console renders a dedicated screen for it.
   */
  async myHub(userId: string): Promise<StaffedHubRow | null> {
    return this.hub.transaction((manager) => this.repo.findMyHub(manager, userId));
  }

  /**
   * Assert the principal may manage staff at this hub.
   *
   * Two paths:
   *   1. The principal is assigned to this hub as MANAGER.
   *   2. The principal is a platform admin — detected by holding a scope no hub role carries
   *      (`shipments:write`). A guard that knows role names breaks the day a role is renamed;
   *      scope detection is the stable seam.
   *
   * A HUB_MANAGER assigned to a different hub is denied — the scope grants the power to manage
   * staff somewhere, the assignment says where.
   */
  async assertCanManageHub(hubCode: string, principal: ApiPrincipal): Promise<void> {
    if (hasScope(principal, 'shipments:write')) return; // platform admin

    const myHub = await this.myHub(principal.subjectId);
    if (myHub && myHub.code === hubCode && myHub.staffRole === 'MANAGER') return;

    throw new ResourceNotFoundError(`Hub "${hubCode}" not found.`);
  }

  /**
   * The active staff at one hub.
   *
   * The caller must be a manager AT THIS HUB (or platform admin). The assignment is checked in the
   * controller via the hub the request names, not by scope alone — `hub:manage` grants the power to
   * manage staff somewhere, and the assignment says where.
   */
  async listAtHub(hubCode: string): Promise<readonly StaffRow[]> {
    return this.hub.transaction(async (manager) => {
      const hub = await this.repo.findByCode(manager, hubCode);
      if (!hub) throw new ResourceNotFoundError(`Hub "${hubCode}" not found.`);
      return this.repo.listStaff(manager, hub.id);
    });
  }

  /**
   * Assign a user to a hub.
   *
   * Validates that the user exists (via `UserService`, not by reading identity tables) and that the
   * role is one of the two allowed values. The partial unique index enforces that the user is not
   * already assigned elsewhere.
   */
  async assign(params: {
    readonly hubCode: string;
    readonly userId: string;
    readonly role: string;
    readonly assignedBy: string;
  }): Promise<StaffRow> {
    const role = assertStaffRole(params.role);
    const user = await this.users.findById(params.userId);
    if (!user) throw new ResourceNotFoundError(`User "${params.userId}" not found.`);

    return this.hub.transaction(async (manager) => {
      const hub = await this.repo.findByCode(manager, params.hubCode);
      if (!hub) throw new ResourceNotFoundError(`Hub "${params.hubCode}" not found.`);
      return this.repo.assignStaff(manager, {
        userId: params.userId,
        hubId: hub.id,
        role,
        assignedBy: params.assignedBy,
      });
    });
  }

  /**
   * Revoke a user's assignment at a hub.
   *
   * 404 if the user has no active assignment at this hub — not a 403, because a 403 would confirm
   * the assignment existed and turn this into an oracle for who works where.
   */
  async revoke(params: { readonly hubCode: string; readonly userId: string }): Promise<void> {
    const touched = await this.hub.transaction(async (manager) => {
      const hub = await this.repo.findByCode(manager, params.hubCode);
      if (!hub) throw new ResourceNotFoundError(`Hub "${params.hubCode}" not found.`);
      return this.repo.revokeStaff(manager, hub.id, params.userId);
    });
    if (touched === 0) {
      throw new ResourceNotFoundError(
        `User "${params.userId}" is not assigned to hub "${params.hubCode}".`,
      );
    }
  }
}

/**
 * Validate the staff role against the two allowed values.
 *
 * The database CHECK constraint is the real guard; this is what turns a bad value into a clear
 * message before the query runs, rather than a Postgres constraint violation that surfaces as 500.
 */
function assertStaffRole(value: string): HubStaffRole {
  if (value !== 'MANAGER' && value !== 'OPERATOR') {
    throw new ValidationFailedError([{ path: 'role', message: 'Must be MANAGER or OPERATOR.' }]);
  }
  return value;
}
