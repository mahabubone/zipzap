import { Controller, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, type AuthenticatedRequest } from './api-key.guard.ts';
import { MerchantAuthService } from '../merchant/sessions.service.ts';

@ApiTags('auth')
@Controller('v1/auth')
export class LogoutController {
  constructor(@Inject(MerchantAuthService) private readonly sessions: MerchantAuthService) {}

  // Bearer sessions only — an API key principal has no session to revoke.
  @Post('logout')
  @HttpCode(204)
  @UseGuards(ApiKeyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current bearer session' })
  async logout(@Req() req: AuthenticatedRequest): Promise<void> {
    const p = req.principal;
    if (p?.kind !== 'human' || !p.credentialId) return;
    await this.sessions.revokeSession(p.credentialId);
  }
}
