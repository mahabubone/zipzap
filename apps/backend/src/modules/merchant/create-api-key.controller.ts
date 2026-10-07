/**
 * POST /v1/api-keys — create a scoped machine credential for yourself.
 *
 * Delegation rule: you can only grant scopes you hold. A merchant admin may
 * mint an integration key for 'shipments:read' only — never a broader set.
 * The raw secret is returned exactly once; only its scrypt hash is stored.
 */

import { Body, Controller, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayNotEmpty, IsIn } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { CreateApiKeyService } from './create-api-key.service';
import { API_SCOPES, type ApiScope } from '../../common/scopes.ts';

export class CreateApiKeyDto {
  @ArrayNotEmpty()
  @IsIn(API_SCOPES, { each: true })
  scopes!: ApiScope[];
}

@ApiTags('api-keys')
@Controller('v1/api-keys')
@UseGuards(ApiKeyGuard)
export class CreateApiKeyController {
  constructor(@Inject(CreateApiKeyService) private readonly keys: CreateApiKeyService) {}

  @Post()
  @UseGuards(new ScopeGuard('keys:manage'), new RateLimitGuard('merchant', true))
  @ApiOperation({ summary: 'Create a scoped API key (secret shown once)' })
  async create(
    @Body() body: CreateApiKeyDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ keyId: string; secret: string; scopes: ApiScope[] }> {
    const merchantId = request.principal!.merchantId!;
    const held = new Set(request.principal!.scopes);
    const requested = body.scopes.filter((scope) => held.has(scope));

    return this.keys.create(merchantId, requested);
  }
}
