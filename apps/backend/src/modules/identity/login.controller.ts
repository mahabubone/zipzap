import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthenticationRequiredError } from '../../common/domain-error.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { AuthSessionResponseDto, AuthTokenResponseDto } from './auth-response.dto.ts';
import { MerchantAuthService } from '../merchant/sessions.service.ts';
import { setSessionCookie, SESSION_IDLE_TTL_HOURS } from './session-cookie.ts';
import { normalisePhone } from './rules/phone.ts';

export class LoginDto {
  @ApiProperty({
    example: 'owner@example.com',
    description:
      'The handle the account is registered under — an email address for a merchant, or a phone ' +
      'number for a rider. A rider is issued a SIM card, not a mailbox, and does not know or ' +
      'care which kind of identifier their depot gave them, so there is one field and the ' +
      'server works out which it is. Phone numbers are accepted in any format a person writes ' +
      'them: `01712345678`, `+8801712345678`, `+880 1712-345678` are one account, not three.',
  })
  @IsString()
  @MinLength(3)
  identifier!: string;

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
      'A handle (email or phone), a password, and optionally which business to act inside. ' +
      'Omit `merchantId` and the first membership is chosen deterministically.',
  })
  @ApiErrors()
  async login(
    @Body() body: LoginDto,
    @Req() req: Request & { requestId?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionResponseDto> {
    const session = await this.auth.loginWithPassword({
      ...resolveHandle(body.identifier),
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
      'A handle (email or phone) and a password. Nothing is set as a cookie, so this is the ' +
      'flow for a client with nowhere to keep one — which is exactly the rider app.',
  })
  @ApiErrors()
  async token(
    @Body() body: LoginDto,
    @Req() req: Request & { requestId?: string },
  ): Promise<AuthTokenResponseDto> {
    const session = await this.auth.loginWithPassword({
      ...resolveHandle(body.identifier),
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

/**
 * Turn a typed handle into the (identifier, kind) pair the auth service wants.
 *
 * Split out of both endpoints so there is exactly one definition of "is this an email or a phone",
 * and so it can be reasoned about without constructing a Nest request. The order is email first:
 * an `@` is unambiguous, while a digit run could be several things and the phone normaliser is the
 * one that can still say no.
 *
 * A phone that does not normalise falls through as an email, which finds nothing and answers the
 * same 401 as a wrong password. That is deliberate — a specific "that is not a valid phone number"
 * is a tell, and a login endpoint that tells you how to format a handle is a login endpoint that
 * helps someone enumerate accounts.
 */
function resolveHandle(typed: string): { identifier: string; handleKind: 'email' | 'phone' } {
  const trimmed = typed.trim();
  if (!trimmed.includes('@')) {
    const phone = normalisePhone(trimmed);
    if (phone !== null) return { identifier: phone, handleKind: 'phone' };
  }
  return { identifier: trimmed, handleKind: 'email' };
}
