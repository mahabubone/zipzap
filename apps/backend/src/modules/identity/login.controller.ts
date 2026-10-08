/**
 * POST /v1/auth/login — human principal issuance. No guard: this is the door in.
 *
 * The response returns the raw bearer token exactly once. scrypt on every
 * attempt is the rate limiter the honest way: credential stuffing pays 72ms
 * per guess (docs/operations/performance.md's scrypt finding was the same
 * price, and here we spend it on purpose).
 *
 * Provenance (ip, user-agent, request_id) is passed to the auth service rather than read here, so
 * the audit row is written where the credential decision is made and not in a controller.
 */

import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import type { Request } from 'express';
import { AuthenticationRequiredError } from '../../common/domain-error.ts';
import { MerchantAuthService, type IssuedSession } from '../merchant/sessions.service.ts';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

@ApiTags('auth')
@Controller('v1/auth')
export class LoginController {
  constructor(@Inject(MerchantAuthService) private readonly auth: MerchantAuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Log in with email + password, returns a bearer session token' })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request & { requestId?: string },
  ): Promise<IssuedSession & { tokenType: 'Bearer' }> {
    const session = await this.auth.loginWithPassword({
      email: body.email,
      password: body.password,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      requestId: req.requestId ?? null,
    });
    if (!session) throw new AuthenticationRequiredError();
    return { ...session, tokenType: 'Bearer' };
  }
}
