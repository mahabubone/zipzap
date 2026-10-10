/**
 * POST /v1/cod/collect — thin by design: validate, call one use case, return.
 *
 * Idempotency-Key is load-bearing here, not ceremonial: a rider on a flaky connection collecting
 * twice must not produce two collections. The guard is enforced at this boundary because a
 * missing key on a money-moving operation is the failure the whole design exists to prevent.
 */

import { Body, Controller, Headers, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsUUID, Min } from 'class-validator';
import { ApiKeyGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { CollectCodService } from './collect-cod.service.ts';
import { CollectedCodDto } from './cod-response.dto.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';

export class CollectCodDto {
  @IsUUID('4')
  shipmentId!: string;

  /** Integer minor units. A decimal here is a bug, not a convenience. */
  @IsInt()
  @Min(0)
  collectedMinor!: number;
}

@ApiTags('cod')
@Controller('v1/cod')
@UseGuards(ApiKeyGuard)
export class CollectCodController {
  constructor(@Inject(CollectCodService) private readonly collectCod: CollectCodService) {}

  @Post('collect')
  @ApiOperation({ summary: 'Record a COD collection' })
  @ApiOkResponse({ type: CollectedCodDto })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async collect(
    @Body() body: CollectCodDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CollectedCodDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }

    const { result, replayed } = await this.collectCod.execute({
      shipmentId: body.shipmentId,
      collectedMinor: body.collectedMinor,
      idempotencyKey: idempotencyKey.trim(),
      actorId: request.principal?.subjectId ?? null,
    });

    return { ...result, replayed };
  }
}
