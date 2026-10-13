/**
 * POST /v1/api-keys — create a scoped machine credential for yourself.
 *
 * Delegation rule: you can only grant scopes you hold. A merchant admin may
 * mint an integration key for 'shipments:read' only — never a broader set.
 * The raw secret is returned exactly once; only its scrypt hash is stored.
 */

import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayNotEmpty, IsIn } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { CreateApiKeyService } from './create-api-key.service';
import { API_SCOPES, type ApiScope } from '../../common/scopes.ts';
import { CreatedApiKeyDto } from './merchant-response.dto.ts';

export class CreateApiKeyDto {
  @ApiProperty({
    example: ['shipments:read', 'tracking:read'],
    type: String,
    isArray: true,
    description:
      'The scopes the key should hold, from the `API_SCOPES` vocabulary. A scope you do not hold ' +
      'yourself is dropped rather than refused, so read the returned scopes.',
  })
  @ArrayNotEmpty()
  @IsIn(API_SCOPES, { each: true })
  scopes!: ApiScope[];
}

@ApiTags('api-keys')
@Controller('v1/api-keys')
@UseGuards(ApiKeyGuard)
export class CreateApiKeyController {
  constructor(@Inject(CreateApiKeyService) private readonly keys: CreateApiKeyService) {}

  @ApiErrors()
  @Post()
  @UseGuards(new ScopeGuard('keys:manage'), new RateLimitGuard('merchant', true))
  @ApiOperation({
    summary: 'Create a scoped API key (secret shown once)',
    description:
      'Mints a machine credential for your own business, so no business is named in the request. ' +
      'You can only grant what you already hold: anything outside your scopes is dropped from the ' +
      'key rather than refused, and a scope outside the vocabulary is a 400.',
  })
  @ApiBody({
    type: CreateApiKeyDto,
    description:
      'The scopes to grant, at least one and all from the `API_SCOPES` vocabulary. Everything the ' +
      'returned key can do is in `scopes` — nothing broader leaks in.',
  })
  @ApiCreatedResponse({
    type: CreatedApiKeyDto,
    description:
      'The key id to send, and its raw secret, returned exactly once. Only a scrypt hash is stored, ' +
      'so a lost secret cannot be recovered — make another key. The mint is audited in the same ' +
      'transaction as the insert.',
  })
  async create(
    @Body() body: CreateApiKeyDto,
    @Req() request: AuthenticatedRequest & { requestId?: string },
  ): Promise<CreatedApiKeyDto> {
    const principal = request.principal!;
    const held = new Set(principal.scopes);
    const requested = body.scopes.filter((scope) => held.has(scope));

    return this.keys.create(principal.merchantId!, requested, {
      actorType: principal.kind,
      actorId: principal.credentialId,
      requestId: request.requestId ?? null,
      ip: request.ip ?? null,
    });
  }
}
