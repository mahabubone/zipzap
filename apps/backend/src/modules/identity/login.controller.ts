import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthenticationRequiredError } from '../../common/domain-error.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { AuthSessionResponseDto, AuthTokenResponseDto } from './auth-response.dto.ts';
import { MerchantAuthService } from '../merchant/sessions.service.ts';
import { setSessionCookie, SESSION_IDLE_TTL_HOURS } from './session-cookie.ts';

export class LoginDto {
  @ApiProperty({
    example: 'owner@example.com',
    description: 'The address the account is registered under.',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'correct horse battery staple',
    description:
      'The account password, checked against a scrypt hash. An unknown address, a disabled user, ' +
      'a wrong password and an inactive business all answer the same 401.',
  })
  @IsString()
  password!: string;

  /** Which business to act inside. Omitted = the first membership, chosen deterministically. */
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Business to open the session against',
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  })
  @IsOptional()
  @IsUUID('4')
  merchantId?: string;
}

@ApiTags('auth')
@Controller('v1/auth')
export class LoginController {
  constructor(@Inject(MerchantAuthService) private readonly auth: MerchantAuthService) {}

  /**
   * POST /v1/auth/login — the browser flow.
   *
   * Issues the session and hands it back as an `HttpOnly` cookie. The token is deliberately NOT
   * also in the response body: an XSS reads response bodies, so returning it there would undo the
   * entire point of the cookie. A client that needs the raw token calls `/auth/token` instead.
   *
   * `SameSite=Lax` and `Secure` mean the cookie rides same-origin POSTs but not cross-site ones,
   * which is what the CSRF middleware leans on.
   */
  @Post('login')
  @ApiOperation({
    summary: 'Sign in with email and password (browser flow)',
    description:
      'Issues a session as an `HttpOnly; Secure; SameSite=Lax` cookie, and returns the expiry and ' +
      'the businesses it may act inside. The token itself is not in the response body — script can ' +
      'read that. A native or machine client that needs the raw token calls ' +
      '`POST /v1/auth/token` instead, which returns it and sets no cookie.',
  })
  @ApiCreatedResponse({
    type: AuthSessionResponseDto,
    description: 'Session issued. The token is in the Set-Cookie header, not in this body.',
  })
  @ApiBody({
    type: LoginDto,
    description:
      'Email and password, and optionally which business to act inside. Omit `merchantId` and the ' +
      'first membership is chosen deterministically.',
  })
  @ApiErrors()
  async login(
    @Body() body: LoginDto,
    @Req() req: Request & { requestId?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponseDto> {
    const session = await this.auth.loginWithPassword({
      email: body.email,
      password: body.password,
      merchantId: body.merchantId ?? null,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      requestId: req.requestId ?? null,
    });
    if (!session) throw new AuthenticationRequiredError();

    setSessionCookie(res, session.token, session.expiresAt);
    return {
      expiresAt: session.expiresAt.toISOString(),
      merchantId: session.merchantId,
      merchantIds: session.merchantIds,
    };
  }

  /**
   * POST /v1/auth/token — the machine flow.
   *
   * Same service call, same audit trail, same scrypt cost against a stuffing run. The only
   * difference is where the credential lands: in the body, because an Expo app has nowhere to put
   * a cookie and a server-side integration has nowhere to send one back to.
   *
   * No cookie is set, so a browser script that reaches this endpoint gains nothing: it gets a
   * token it could already have stolen from `/auth/token` anyway, but it does not gain a session
   * the browser will silently attach to every later request.
   */
  @Post('token')
  @ApiOperation({
    summary: 'Sign in and receive the bearer token (machine flow)',
    description:
      'For native and server-side clients that cannot hold a cookie. Returns the token in the ' +
      'body, sets no cookie, and is rate limited exactly as `/auth/login` is.',
  })
  @ApiCreatedResponse({
    type: AuthTokenResponseDto,
    description: 'Session issued. The token is in this body — store it securely.',
  })
  @ApiBody({
    type: LoginDto,
    description:
      'Email and password, and optionally which business to act inside. Nothing is set as a cookie, ' +
      'so this is the flow for a client with nowhere to keep one.',
  })
  @ApiErrors()
  async token(
    @Body() body: LoginDto,
    @Req() req: Request & { requestId?: string },
  ): Promise<AuthTokenResponseDto> {
    const session = await this.auth.loginWithPassword({
      email: body.email,
      password: body.password,
      merchantId: body.merchantId ?? null,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      requestId: req.requestId ?? null,
    });
    if (!session) throw new AuthenticationRequiredError();
    return {
      token: session.token,
      tokenType: 'Bearer',
      expiresInSeconds: SESSION_IDLE_TTL_HOURS * 60 * 60,
      expiresAt: session.expiresAt.toISOString(),
      merchantId: session.merchantId,
      merchantIds: session.merchantIds,
    };
  }
}
