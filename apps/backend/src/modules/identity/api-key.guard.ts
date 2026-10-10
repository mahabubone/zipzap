/**
 * Auth guard. Resolves an ApiPrincipal and attaches it to the request.
 *
 * A permission check without a tenant scope is a data breach waiting for a missing WHERE, so the
 * principal carries merchantId and the use case asserts against it. The guard never reads a
 * merchantId from the request.
 */

import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { hasScope, type ApiPrincipal } from './rules/api-principal.ts';
import { PermissionDeniedError } from '../../common/domain-error.ts';
import { AuthenticateApiKeyService } from './authenticate-api-key.service.ts';
import { readSessionCookie } from './session-cookie.ts';
import type { ApiScope } from '../../common/scopes.ts';

export interface AuthenticatedRequest extends Request {
  principal?: ApiPrincipal;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(AuthenticateApiKeyService) private readonly authenticate: AuthenticateApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.principal = await this.authenticate.authenticate(
      request.headers.authorization,
      readSessionCookie(request),
    );
    return true;
  }
}

@Injectable()
export class ScopeGuard implements CanActivate {
  constructor(private readonly required: ApiScope) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.principal;
    if (!principal) throw new PermissionDeniedError('No authenticated principal.');
    if (!hasScope(principal, this.required)) {
      throw new PermissionDeniedError(`Missing scope ${this.required}.`);
    }
    return true;
  }
}
