import { Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiNoContentResponse } from '@nestjs/swagger';
import { ApiKeyGuard, type AuthenticatedRequest } from './api-key.guard.ts';
import { MerchantAuthService } from '../merchant/sessions.service.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';

@ApiTags('auth')
@Controller('v1/auth')
export class LogoutController {
  constructor(@Inject(MerchantAuthService) private readonly sessions: MerchantAuthService) {}

  // Bearer sessions only — an API key principal has no session to revoke.
  @Post('logout')
  @HttpCode(204)
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Revoke the current session',
    description:
      'Revokes this session only, not every session the person holds. An API key principal has no ' +
      'session, so calling it with one revokes nothing and still returns 204.',
  })
  @ApiNoContentResponse({
    description:
      'The session is revoked, or there was none to revoke. Indistinguishable by design.',
  })
  @ApiErrors()
  async logout(@Req() req: AuthenticatedRequest & { requestId?: string }): Promise<void> {
    const p = req.principal;
    if (p?.kind !== 'human' || !p.credentialId) return;
    // The revocation is audited inside the service, with the session itself — a logout that
    // succeeded but left no trail is indistinguishable from one that never happened.
    await this.sessions.revokeSession(p.credentialId, {
      merchantId: p.merchantId,
      ip: req.ip ?? null,
      requestId: req.requestId ?? null,
    });
  }
}
