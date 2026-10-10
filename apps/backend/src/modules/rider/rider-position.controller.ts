/**
 * POST /v1/riders/:riderId/position — where a rider is, right now.
 *
 * Guarded on `rider:sync`, the platform scope Stage 4 introduced. A merchant is our client, not our
 * network partner: a client's key must not be able to write or read a named rider's movements.
 *
 * No Idempotency-Key. This is a position, not an event with consequences — replaying one is
 * harmless because the write is an overwrite of the present tense. What must not be replayed is a
 * *command*, and those go through `/sync/replay`.
 */

import { Body, Controller, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsLatitude, IsLongitude, IsNumber, IsOptional } from 'class-validator';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { RecordPositionService } from './record-position.service.ts';
import { RiderPositionDto } from './rider-response.dto.ts';

export class RecordPositionDto {
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  /** The device's clock. A stale ping is refused by the service rather than applied. */
  @IsISO8601()
  recordedAt!: string;

  @IsOptional()
  @IsNumber()
  accuracyMeters?: number;
}

@ApiTags('riders')
@Controller('v1/riders')
@UseGuards(ApiKeyGuard)
export class RiderPositionController {
  constructor(@Inject(RecordPositionService) private readonly positions: RecordPositionService) {}

  @Post(':riderId/position')
  @UseGuards(new ScopeGuard('rider:sync'))
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a rider position. Never visible on public tracking.' })
  @ApiParam({ name: 'riderId', description: 'The rider whose position is recorded.' })
  @ApiOkResponse({ type: RiderPositionDto })
  @ApiErrors()
  async record(
    @Param('riderId') riderId: string,
    @Body() body: RecordPositionDto,
  ): Promise<RiderPositionDto> {
    return this.positions.execute({
      riderId,
      latitude: body.latitude,
      longitude: body.longitude,
      recordedAt: new Date(body.recordedAt),
      accuracyMeters: body.accuracyMeters ?? null,
    });
  }
}
