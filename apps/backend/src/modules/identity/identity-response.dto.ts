/**
 * Response DTOs for the identity module's session endpoints.
 *
 * `IssuedSession` and `ApiPrincipal` are interfaces, so they produced no schemas and
 * `POST /v1/auth/login` — the one endpoint every client has to call — responded with no `content`
 * at all. See ADR-0004.
 *
 * Field-for-field the shapes the service actually returns, in the same order and with the same
 * nullability. A DTO that documents a field the endpoint does not send is worse than no DTO: the
 * client codes against it and gets `undefined`.
 */

import { ApiProperty } from '@nestjs/swagger';
import type { ApiScope } from '../../common/scopes.ts';

/** The credential that were issued. Returned once, at login, and never again. */
export class IssuedSessionResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…',
    description:
      'The raw session token. Returned exactly once, at issue. It is stored hashed, so it cannot be recovered — losing it means signing in again.',
  })
  token!: string;

  @ApiProperty({ example: 'Bearer', description: 'The Authorization scheme this token goes with.' })
  tokenType!: 'Bearer';

  @ApiProperty({
    example: '2026-10-10T19:58:00.000Z',
    description:
      'Absolute expiry, as an ISO 8601 instant. Not slid by activity: re-authenticate before this.',
  })
  expiresAt!: string;

  @ApiProperty({
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    description: 'The business this session acts inside — a selection within merchantIds.',
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

/** The authenticated principal, as `GET /v1/me` returns it. */
export class ApiPrincipalResponseDto {
  @ApiProperty({
    example: 'human',
    enum: ['human', 'machine'],
    description: 'Which credential kind proved identity. Never interchangeable.',
  })
  kind!: 'human' | 'machine';

  @ApiProperty({
    example: '9f8e7d6c-5b4a-3210-fedc-ba9876543210',
    description: 'The user behind a human principal, or the API key behind a machine one.',
  })
  subjectId!: string;

  @ApiProperty({
    example: 'Ayesha Begum',
    nullable: true,
    description:
      'A human-readable name for a human principal, so a console can render who is signed in ' +
      'without showing a UUID. Falls back to the login email when no display name is set. ' +
      'Always null for a machine principal — an API key has no person to name.',
  })
  displayName!: string | null;

  @ApiProperty({
    example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
    nullable: true,
    description:
      'The ACTIVE business — the one this request acts inside, always one of merchantIds. Null for a platform administrative key.',
  })
  merchantId!: string | null;

  @ApiProperty({
    example: ['b2c3d4e5-f6a7-8901-bcde-f12345678901'],
    type: String,
    isArray: true,
    description: 'Every business this principal may act inside. A machine key has exactly one.',
  })
  merchantIds!: readonly string[];

  @ApiProperty({
    example: ['shipments:read', 'shipments:write'],
    type: String,
    isArray: true,
    description: 'Scopes this principal holds. An endpoint requires one of its declared scopes.',
  })
  scopes!: readonly ApiScope[];

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  credentialId!: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Per-minute request ceiling this credential carries. Null = the tier default.',
  })
  rateLimitPerMin!: number | null;
}
