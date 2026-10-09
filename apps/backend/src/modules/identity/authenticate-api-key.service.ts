/**
 * API key authentication. Resolves a principal from an `ApiKey <key_id>.<secret>` header.
 *
 * Every failure returns the SAME error. A different error for "no such key" and "wrong secret"
 * turns this endpoint into a key-enumeration oracle, which is why there is one `denied` value
 * and no early return that behaves differently.
 */

import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { AuthenticationRequiredError, PermissionDeniedError } from '../../common/domain-error.ts';
import { verifySecret } from '../../common/secret.ts';
import { type ApiScope } from '../../common/scopes.ts';
import { isRoleName, scopesForRole } from './rules/roles.ts';
import { canAcceptShipments } from '../merchant/rules/merchant.ts';
import { FindCredentialService } from '../merchant/find-credential.service.ts';
import { MerchantAuthService } from '../merchant/sessions.service.ts';
import { UserService } from './user.service.ts';
import { merchantIdsOf } from './rules/users.ts';
import type { ApiPrincipal } from './rules/api-principal.ts';

export const FIND_CREDENTIAL = Symbol('FIND_CREDENTIAL');

@Injectable()
export class AuthenticateApiKeyService {
  constructor(
    // Injected merchant services, not merchant's repository. The seam is the point.
    @Inject(FIND_CREDENTIAL) private readonly credentials: FindCredentialService,
    @Inject(MerchantAuthService) private readonly sessions: MerchantAuthService,
    @Inject(UserService) private readonly users: UserService,
  ) {}

  async authenticate(header: string | undefined): Promise<ApiPrincipal> {
    const denied = new AuthenticationRequiredError();

    // Human: Bearer <session token>. Machine: ApiKey <key_id>.<secret>.
    // Never interchangeable — an API key cannot open a console, and
    // a console token cannot call integrations.
    if (header?.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length).trim();
      const session = token.length > 0 ? await this.sessions.authenticateToken(token) : null;
      if (!session) throw denied;
      // The membership set, re-read on every request rather than trusted from the session. A
      // membership revoked mid-session must stop working immediately; a token carrying its own copy
      // of "which businesses am I in" would keep serving the revoked one until it expired.
      const user = await this.users.findById(session.userId);
      if (!user || user.disabledAt !== null) throw denied;

      // The role in the ACTIVE business — not a role on the user, and not the full vocabulary.
      // Granting every scope here made every browser session omnipotent, including
      // `settlements:approve` and `keys:manage`, so one stolen console token could approve a
      // settlement and mint itself a fresh credential.
      //
      // A membership revoked mid-session lands here as a throw, and it must collapse into the SAME
      // `denied` as every other auth failure. Letting `roleForMerchant`'s PermissionDeniedError out
      // would answer 403 "you may not access business X" for a token that is simply no longer valid
      // — which both tells an attacker which of their guessed business ids is real, and lets a
      // legitimately-revoked employee keep probing with a token that should be dead.
      const membership = user.memberships.find((m) => m.merchantId === session.merchantId);
      if (!membership) throw denied;
      // Re-validated here rather than trusted from the cast in UserService: the membership's role
      // is a stored string, and an unrecognised one must fail closed, not widen the token.
      if (!isRoleName(membership.role)) throw denied;

      return {
        kind: 'human',
        subjectId: user.userId,
        merchantId: session.merchantId,
        // One entry per membership. This is what lets one login act inside two businesses without a
        // second credential — the Stage 0 exit check's multi-business assertion.
        merchantIds: merchantIdsOf(user),
        scopes: scopesForRole(membership.role),
        credentialId: session.id,
        rateLimitPerMin: session.rateLimitPerMin,
      };
    }

    if (!header?.startsWith('ApiKey ')) throw denied;

    const presented = header.slice('ApiKey '.length).trim();
    const separator = presented.indexOf('.');
    if (separator <= 0 || separator === presented.length - 1) throw denied;

    const keyId = presented.slice(0, separator);
    const secret = presented.slice(separator + 1);

    const credential = await this.credentials.findByKeyId(keyId);
    if (!credential) throw denied;
    if (credential.revokedAt !== null) throw denied;

    if (!(await verifySecret(secret, credential.secretHash))) throw denied;

    // A suspended merchant keeps its credential but loses the ability to create shipments.
    if (!canAcceptShipments(credential.merchantStatus)) {
      throw new PermissionDeniedError(`Merchant is ${credential.merchantStatus}.`);
    }

    await this.credentials.touchLastUsed(credential.id);

    return {
      kind: 'machine',
      subjectId: credential.merchantId,
      // Tenant scope is DERIVED from the credential. Never read from a request body.
      merchantId: credential.merchantId,
      // An API key is issued to ONE merchant, and a request cannot widen it. A machine principal
      // carrying a membership set would be a key that could reach a second tenant.
      merchantIds: [credential.merchantId],
      scopes: credential.scopes as ApiScope[],
      credentialId: credential.id,
      rateLimitPerMin: credential.rateLimitPerMin,
    };
  }
}
