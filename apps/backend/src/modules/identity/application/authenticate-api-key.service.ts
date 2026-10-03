/**
 * API key authentication. Resolves a principal from an `ApiKey <key_id>.<secret>` header.
 *
 * Every failure returns the SAME error. A different error for "no such key" and "wrong secret"
 * turns this endpoint into a key-enumeration oracle, which is why there is one `denied` value
 * and no early return that behaves differently.
 */

import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
} from '../../../common/domain-error.ts';
import { verifySecret } from '../../../common/secret.ts';
import { canAcceptShipments } from '../../merchant/domain/merchant.ts';
import { FindCredentialService } from '../../merchant/application/find-credential.service.ts';
import type { ApiPrincipal } from '../domain/api-principal.ts';
import type { ApiScope } from '../../../common/scopes.ts';

export const FIND_CREDENTIAL = Symbol('FIND_CREDENTIAL');

@Injectable()
export class AuthenticateApiKeyService {
  constructor(
    // Injected merchant service, not merchant's repository. The seam is the point.
    @Inject(FIND_CREDENTIAL) private readonly credentials: FindCredentialService,
  ) {}

  async authenticate(header: string | undefined): Promise<ApiPrincipal> {
    const denied = new AuthenticationRequiredError();
    if (!header?.startsWith('ApiKey ')) throw denied;

    const presented = header.slice('ApiKey '.length).trim();
    const separator = presented.indexOf('.');
    if (separator <= 0 || separator === presented.length - 1) throw denied;

    const keyId = presented.slice(0, separator);
    const secret = presented.slice(separator + 1);

    const credential = await this.credentials.findByKeyId(keyId);
    if (!credential) throw denied;
    if (credential.revokedAt !== null) throw denied;

    if (!verifySecret(secret, credential.secretHash)) throw denied;

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
    };
  }
}
