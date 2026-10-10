/**
 * POST /v1/auth/login — human principal issuance. No guard: this is the door in.
 *
 * The response returns the raw bearer token exactly once. scrypt on every
 * attempt is the rate limiter the honest way: credential stuffing pays 72ms
 * per guess (docs/operations/performance.md's scrypt finding was the same
 * price, and here we spend it on purpose).
 *
 * `merchantId` is OPTIONAL and names which business to open the session against, for a person who
 * belongs to more than one. It is a request for a scope, never an assertion of one: a business the
 * user does not hold is refused (login fails), never quietly ignored. Ignoring it would sign them
 * into the default business and return a 200, which is a cross-tenant read wearing a success code.
 *
 * Provenance (ip, user-agent, request_id) is passed to the auth service rather than read here, so
 * the audit row is written where the credential decision is made and not in a controller.
 */

import { Body, Controller, Inject, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';
import type { Request } from 'express';
import { AuthenticationRequiredError } from '../../common/domain-error.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { MerchantAuthService, type IssuedSession } from '../merchant/sessions.service.ts';
import { IssuedSessionResponseDto } from './identity-response.dto.ts';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  /** Which business to act inside. Omitted = the first membership, chosen deterministically. */
  @ApiPropertyOptional({ format: 'uuid', description: 'Business to open the session against' })
  @IsOptional()
  @IsUUID('4')
  merchantId?: string;
}

@ApiTags('auth')
@Controller('v1/auth')
export class LoginController {
  constructor(@Inject(MerchantAuthService) private readonly auth: MerchantAuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'Sign in with email and password',
    description:
      'Returns a bearer session token, shown exactly once. A browser console sends it back as ' +
      '`Bearer` on the Authorization header; the ZipZap consoles instead let the server set it as ' +
      'an HttpOnly cookie. Whatever the transport, it is stored hashed, so it cannot be recovered.',
  })
  @ApiCreatedResponse({ type: IssuedSessionResponseDto })
  @ApiErrors()
  async login(
    @Body() body: LoginDto,
    @Req() req: Request & { requestId?: string },
  ): Promise<IssuedSession & { tokenType: 'Bearer' }> {
    const session = await this.auth.loginWithPassword({
      email: body.email,
      password: body.password,
      merchantId: body.merchantId ?? null,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      requestId: req.requestId ?? null,
    });
    if (!session) throw new AuthenticationRequiredError();
    return { ...session, tokenType: 'Bearer' };
  }
}
