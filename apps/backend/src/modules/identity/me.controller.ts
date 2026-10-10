/**
 * GET /v1/me — the authenticated principal, for clients that need to render themselves.
 *
 * The guard derives the principal from the credential; this endpoint just hands it back so a
 * web or mobile client knows its merchant scope and scopes without a second round-trip.
 */

import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, type AuthenticatedRequest } from './api-key.guard.ts';
import type { ApiPrincipal } from './rules/api-principal.ts';
import { ApiPrincipalResponseDto } from './identity-response.dto.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';

@ApiTags('identity')
@Controller('v1')
@UseGuards(ApiKeyGuard)
export class MeController {
  @Get('me')
  @ApiOperation({
    summary: 'The authenticated principal',
    description:
      'For a client that needs to render itself: which business it is acting inside, every business ' +
      'it may act inside, and the scopes it holds. `merchantId` is the ACTIVE business and is ' +
      'derived from the credential, never taken from the request.',
  })
  @ApiOkResponse({ type: ApiPrincipalResponseDto })
  @ApiErrors()
  me(@Req() request: AuthenticatedRequest): ApiPrincipal {
    return request.principal!;
  }
}
