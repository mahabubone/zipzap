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
import { API_SCOPES, type ApiScope } from '../../common/scopes.ts';
import { canAcceptShipments } from '../merchant/rules/merchant.ts';
import { FindCredentialService } from '../merchant/find-credential.service.ts';
import { MerchantAuthService } from '../merchant/sessions.service.ts';
import type { ApiPrincipal } from './rules/api-principal.ts';

export const FIND_CREDENTIAL = Symbol('FIND_CREDENTIAL');

@Injectable()
export class AuthenticateApiKeyService {
  constructor(
    // Injected merchant services, not merchant's repository. The seam is the point.
    @Inject(FIND_CREDENTIAL) private readonly credentials: FindCredentialService,
    @Inject(MerchantAuthService) private readonly sessions: MerchantAuthService,
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
      return {
        kind: 'human',
        subjectId: session.merchantId,
        merchantId: session.merchantId,
        scopes: [...API_SCOPES],
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
      scopes: credential.scopes as ApiScope[],
      credentialId: credential.id,
      rateLimitPerMin: credential.rateLimitPerMin,
    };
  }
}
