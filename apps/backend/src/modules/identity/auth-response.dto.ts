/**
 * Response DTOs for the auth module's public endpoints.
 *
 * Deliberately two shapes for one session, because the credential travels differently and a DTO
 * that papered over that would be a lie at exactly the point that matters:
 *
 * - `AuthSessionResponseDto` — what `/auth/login` returns to a browser. No `token` field. That is
 *   the whole change: the token is in the `Set-Cookie` header, where script cannot read it, and
 *   putting it in the body as well would give back the XSS exposure the cookie removed.
 * - `AuthTokenResponseDto` — what `/auth/token` returns to a client that cannot hold a cookie.
 *   Carries the token, because it has nowhere else to go.
 */

import { ApiProperty } from '@nestjs/swagger';

/** What `POST /v1/auth/login` returns. The token is in `Set-Cookie`, not here. */
export class AuthSessionResponseDto {
  @ApiProperty({
    example: '2026-10-10T19:58:00.000Z',
    description:
      'Absolute expiry, as an ISO 8601 instant. Sliding: activity extends it, up to 7 days.',
  })
  expiresAt!: string;

  @ApiProperty({
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    description: 'The ACTIVE business this session acts inside — always one of `merchantIds`.',
  })
  merchantId!: string;

  @ApiProperty({
    example: ['b2c3d4e5-f6a7-8901-bcde-f12345678901'],
    type: String,
    isArray: true,
    description: 'Every business the signed-in person belongs to.',
  })
  merchantIds!: readonly string[];
}

/** What `POST /v1/auth/token` returns. The token is here, because it has nowhere else to go. */
export class AuthTokenResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…',
    description: 'The raw session token. Returned exactly once; store it securely.',
  })
  token!: string;

  @ApiProperty({ example: 'Bearer', description: 'The Authorization scheme this token goes with.' })
  tokenType!: 'Bearer';

  @ApiProperty({
    example: 43200,
    description: 'Seconds until expiry. The session is sliding: extend by this much on each use.',
  })
  expiresInSeconds!: number;

  @ApiProperty({
    example: '2026-10-10T19:58:00.000Z',
    description: 'Absolute expiry, as an ISO 8601 instant.',
  })
  expiresAt!: string;

  @ApiProperty({
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    description: 'The ACTIVE business this token acts inside.',
  })
  merchantId!: string;

  @ApiProperty({
    example: ['b2c3d4e5-f6a7-8901-bcde-f12345678901'],
    type: String,
    isArray: true,
    description: 'Every business the signed-in person belongs to.',
  })
  merchantIds!: readonly string[];
}
