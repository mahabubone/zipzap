/**
 * GET /v1/me — the authenticated principal, for clients that need to render themselves.
 *
 * The guard derives the principal from the credential; this endpoint hands it back so a web or
 * mobile client knows its merchant scope and scopes without a second round-trip.
 */

import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, type AuthenticatedRequest } from './api-key.guard.ts';
import type { ApiPrincipal } from './rules/api-principal.ts';
import { UserService } from './user.service.ts';
import { ApiPrincipalResponseDto } from './identity-response.dto.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';

@ApiTags('identity')
@Controller('v1')
@UseGuards(ApiKeyGuard)
export class MeController {
  // Explicit `@Inject()` on every constructor param: esbuild (Vitest's transformer) cannot emit
  // decorator metadata, so a bare param resolves `undefined` under Vitest while working under tsc.
  constructor(@Inject(UserService) private readonly users: UserService) {}

  @Get('me')
  @ApiOperation({
    summary: 'The authenticated principal',
    description:
      'For a client that needs to render itself: which business it is acting inside, every business ' +
      'it may act inside, and the scopes it holds. `merchantId` is the ACTIVE business and is ' +
      'derived from the credential, never taken from the request.',
  })
  @ApiOkResponse({
    type: ApiPrincipalResponseDto,
    description:
      'The principal this request proved itself as, read off the credential and off nothing else in ' +
      'the request: its kind, the business it is acting inside, every business it may act inside, the ' +
      'scopes it holds, and its per-minute ceiling. `merchantId` is null only for a platform ' +
      'administrative key.',
  })
  @ApiErrors()
  async me(@Req() request: AuthenticatedRequest): Promise<ApiPrincipalResponseDto> {
    const principal: ApiPrincipal = request.principal!;

    // Only a person has a name to render. An API key is not a user, and looking one up in
    // `identity.users` would return nothing at best and a stranger's row at worst.
    const displayName =
      principal.kind === 'human' ? await this.users.findDisplayName(principal.subjectId) : null;

    // Field-by-field rather than `{ ...principal, displayName }`: the spread would carry
    // `ApiPrincipal`'s optional `rateLimitPerMin` and its `readonly` arrays straight into a DTO
    // that declares both as required and mutable, which TypeScript rejects and which would
    // silently document a field the response might not send.
    return {
      kind: principal.kind,
      subjectId: principal.subjectId,
      displayName,
      merchantId: principal.merchantId,
      merchantIds: [...principal.merchantIds],
      scopes: [...principal.scopes],
      credentialId: principal.credentialId,
      rateLimitPerMin: principal.rateLimitPerMin ?? null,
    };
  }
}
