import { Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiKeyGuard, type AuthenticatedRequest } from './api-key.guard.ts';
import { MerchantAuthService } from '../merchant/sessions.service.ts';
import { clearSessionCookie } from './session-cookie.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';

@ApiTags('auth')
@Controller('v1/auth')
export class LogoutController {
  constructor(@Inject(MerchantAuthService) private readonly sessions: MerchantAuthService) {}

  /**
   * Revokes whichever session the credential identified — a bearer token from the Authorization
   * header, or the cookie a browser sent — and clears that cookie.
   *
   * 204 on both success and failure: a logout that says "session not found" is a free oracle for
   * testing whether a guessed token is valid.
   */
  @Post('logout')
  @HttpCode(204)
  @UseGuards(ApiKeyGuard)
  @ApiOperation({
    summary: 'Revoke the current session',
    description:
      'Revokes the session identified by the presented credential — `Authorization: Bearer` or the ' +
      '`zipzap_session` cookie — and clears the cookie if one was sent. An API key principal has no ' +
      'session, so it revokes nothing and still returns 204. Indistinguishable by design.',
  })
  @ApiNoContentResponse({ description: 'The session is revoked, or there was none to revoke.' })
  @ApiErrors()
  async logout(
    @Req() req: AuthenticatedRequest & { requestId?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const principal = req.principal;
    // An API key principal has no session row, so there is nothing to revoke and nothing to clear.
    if (principal?.kind === 'human' && principal.credentialId) {
      await this.sessions.revokeSession(principal.credentialId, {
        merchantId: principal.merchantId,
        ip: req.ip ?? null,
        requestId: req.requestId ?? null,
      });
    }
    // Always clear: a client that signs out should not be left holding a cookie that is now
    // useless, and clearing one that was never there is a no-op.
    clearSessionCookie(res);
  }
}
