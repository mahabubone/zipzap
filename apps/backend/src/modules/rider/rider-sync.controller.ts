/**
 * POST /v1/riders/:riderId/sync — pull pending commands for an offline rider.
 * POST /v1/riders/:riderId/sync/ack — acknowledge one (mutating; requires Idempotency-Key).
 *
 * Non-negotiable rule 9: rider offline sync must be idempotent. The pull is read-only and
 * naturally safe; the ack is the rider's delivery-confirm, so it must reject duplicate keys
 * and replay the recorded outcome.
 */

import {
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Post,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { OfflineSyncService, type PullResult, type AckResult } from './offline-sync.service.ts';

class PullDto {
  @IsOptional()
  @IsString()
  sinceSeq?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

class AckDto {
  @IsNotEmpty()
  @IsString()
  commandId!: string;
}

@ApiTags('riders')
@Controller('v1/riders')
@UseGuards(ApiKeyGuard)
export class RiderSyncController {
  constructor(@Inject(OfflineSyncService) private readonly sync: OfflineSyncService) {}

  @Get(':riderId/sync')
  @ApiOperation({ summary: 'Pull pending commands for an offline rider' })
  async pull(@Param('riderId') riderId: string, @Query() dto: PullDto): Promise<PullResult> {
    const since = dto.sinceSeq !== undefined ? Number(dto.sinceSeq) : undefined;
    const limit = dto.limit !== undefined ? Number(dto.limit) : undefined;
    return this.sync.pull(riderId, since, limit);
  }

  @Post(':riderId/sync/ack')
  @ApiOperation({ summary: 'Acknowledge one queued command' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async ack(
    @Param('riderId') riderId: string,
    @Body() dto: AckDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<AckResult & { replayed: boolean }> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }
    const result = await this.sync.acknowledge(dto.commandId, riderId, idempotencyKey.trim(), {
      commandId: dto.commandId,
    });
    return { ...result, replayed: result.replayed ?? false };
  }
}
