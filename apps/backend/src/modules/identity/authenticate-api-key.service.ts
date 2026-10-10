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

  /**
   * Resolves an ApiPrincipal from whichever credential the request carries, or throws.
   *
   * Two sources, because no one of them is enough:
   *
   * - `Authorization: Bearer <session>` — what a native app, a machine integration and a browser
   *   console with a token send.
   * - `Authorization: ApiKey <id>.<secret>` — a machine principal.
   * - the `zipzap_session` cookie — what a browser console sends on an ordinary same-origin
   *   navigation, where a page cannot set an Authorization header. Without it there is no way for a
   *   console to stay signed in once the token stops living in `sessionStorage`, where any script
   *   on the page could read it and replay it from anywhere.
   *
   * The chain is strict rather than a preference order: an `Authorization` header naming neither
   * recognised scheme is REJECTED, not ignored. Falling through to the cookie anyway would let a
   * caller who can send a bogus header be silently answered by whatever session their browser
   * happens to be holding, which turns a malformed header into a credential switch.
   *
   * The principal is identical whichever door the token came through — `resolveSession` is the
   * single place a session token becomes a principal — so scope decisions cannot diverge by
   * transport.
   */
  async authenticate(
    header: string | undefined,
    cookieToken?: string | null,
  ): Promise<ApiPrincipal> {
    const denied = new AuthenticationRequiredError();
    const scheme = header?.slice(0, header.indexOf(' ')).trim() ?? '';

    // Human: Bearer <session token>. Machine: ApiKey <key_id>.<secret>.
    // Never interchangeable — an API key cannot open a console, and
    // a console token cannot call integrations.
    if (scheme === 'Bearer') {
      return this.resolveSession(header!.slice('Bearer '.length).trim());
    }

    if (scheme === 'ApiKey') {
      const presented = header!.slice('ApiKey '.length).trim();
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

    // Any Authorization header we did not recognise is rejected, NOT ignored. Falling through
    // here would let a caller who can send a bogus header be silently answered by whatever session
    // their browser happens to be holding, which turns a malformed header into a credential switch.
    if (header !== undefined) throw denied;

    if (!cookieToken || cookieToken.length === 0) throw denied;
    return this.resolveSession(cookieToken);
  }

  /**
   * A session token becomes a principal. The only place that happens, so the bearer path and the
   * cookie path cannot drift.
   *
   * Every failure collapses into the same `denied`, including a membership revoked mid-session.
   * Letting a "you may not access business X" error out would both answer 403 for a token that is
   * simply no longer valid and tell an attacker which of their guessed business ids is real.
   */
  private async resolveSession(token: string): Promise<ApiPrincipal> {
    const denied = new AuthenticationRequiredError();

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
}
