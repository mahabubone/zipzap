/**
 * POST /v1/auth/login — human principal issuance. No guard: this is the door in.
 *
 * The response returns the raw bearer token exactly once. scrypt on every
 * attempt is the rate limiter the honest way: credential stuffing pays 72ms
 * per guess (docs/operations/performance.md's scrypt finding was the same
 * price, and here we spend it on purpose).
 */

import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
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
  async login(@Body() body: LoginDto): Promise<IssuedSession & { tokenType: 'Bearer' }> {
    const session = await this.auth.loginWithPassword(body.email, body.password);
    if (!session) throw new AuthenticationRequiredError();
    return { ...session, tokenType: 'Bearer' };
  }
}
