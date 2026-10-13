/**
 * POST /v1/cod/collect — thin by design: validate, call one use case, return.
 *
 * Idempotency-Key is load-bearing here, not ceremonial: a rider on a flaky connection collecting
 * twice must not produce two collections. The guard is enforced at this boundary because a
 * missing key on a money-moving operation is the failure the whole design exists to prevent.
 */

import { Body, Controller, Headers, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
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
  @ApiProperty({
    type: 'integer',
    description: 'Integer minor units (poisha). A decimal here is a bug, not a convenience.',
  })
  collectedMinor!: number;
}

@ApiTags('cod')
@Controller('v1/cod')
@UseGuards(ApiKeyGuard)
export class CollectCodController {
  constructor(@Inject(CollectCodService) private readonly collectCod: CollectCodService) {}

  @ApiErrors()
  @Post('collect')
  @ApiOperation({ summary: 'Record a COD collection' })
  @ApiBody({
    type: CollectCodDto,
    description:
      'The shipment being collected against and the cash actually taken, in integer poisha — ' +
      'a decimal amount is rejected here, never rounded. The `Idempotency-Key` header is what ' +
      'makes a retried collection safe.',
  })
  @ApiOkResponse({
    type: CollectedCodDto,
    description:
      'What was actually taken beside the frozen quote that promised it: `expectedMinor` is ' +
      'never rewritten by a collection, so `shortfallMinor` is the gap between promise and ' +
      'reality, recorded rather than smoothed over. Partial collection is a recorded outcome, ' +
      'not an error, and a replay of the same `Idempotency-Key` returns this same body with ' +
      '`replayed: true`.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Retry guard for a money-moving call: a replay with the same key returns the original ' +
      'response instead of collecting twice.',
  })
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
