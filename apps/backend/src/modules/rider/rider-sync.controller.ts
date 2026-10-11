/**
 * The offline-sync wire, in both directions.
 *
 * - `GET  /v1/riders/:riderId/sync`        — pull work queued *for* a rider (ops → device).
 * - `POST /v1/riders/:riderId/sync/ack`    — acknowledge one of those (requires Idempotency-Key).
 * - `POST /v1/riders/:riderId/sync/replay` — a device pushing *its own* day of work back (device → server).
 *
 * The third route is the one ADR-0012's wire always described and this controller never had. Without
 * it a rider who finished a shift with no signal had nowhere to put a single scan: `enqueue` existed,
 * was fully implemented, and had no caller outside tests. The queue was unreachable in production
 * while its unit and integration tests passed.
 *
 * Rule 9 applies to both writes. The ack dedupes on `Idempotency-Key`; the replay dedupes on
 * `(rider_id, device_sequence)`, which is stronger here because it survives the device losing its
 * key — a phone that was factory-reset mid-shift still cannot apply a scan twice.
 *
 * Guarded on `rider:sync`, which is a *platform* scope. A merchant is our client, not our network
 * partner: their staff must not read a rider's queue, which is where a rider's whole day sits.
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiKeyGuard, ScopeGuard } from '../identity/api-key.guard.ts';
import { OfflineSyncService } from './offline-sync.service.ts';
import { AckResultDto, PullResultDto, ReplayResultDto } from './rider-response.dto.ts';

class PullDto {
  /** The rider\'s last acknowledged device sequence — replay only what is newer than this. */
  @IsOptional()
  @IsString()
  sinceSeq?: string;

  /** Cap on the returned window. Defaults to the queue cap. */
  @IsOptional()
  @IsString()
  limit?: string;
}

class AckDto {
  @IsNotEmpty()
  @IsString()
  commandId!: string;
}

export class DeviceCommandDto {
  /** The device's own monotonic counter. With `createdAt` it forms the dedupe key and the order. */
  @IsInt()
  @Min(1)
  deviceSequence!: number;

  /** The device's clock. Deliberately not the server's — the server cannot know when it was pressed. */
  @IsISO8601()
  createdAt!: string;

  @IsNotEmpty()
  @IsString()
  commandType!: string;

  @IsObject()
  payload!: Record<string, unknown>;

  /**
   * What the device believed at the time. `{ status }` for a command about the rider,
   * `{ shipmentId, shipmentStatus }` for one about a parcel — the latter is what lets the server
   * reject a scan of something that was cancelled while the phone was in a pocket.
   */
  @IsOptional()
  @IsObject()
  expectedState?: Record<string, unknown>;
}

export class ReplayDto {
  @IsArray()
  @ArrayMinSize(1)
  // A rider's whole day is the design case, and the queue cap is 100. Two hundred leaves room for a
  // second shift on one sequence without letting one request carry an unbounded payload.
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DeviceCommandDto)
  commands!: DeviceCommandDto[];
}

@ApiTags('riders')
@Controller('v1/riders')
@UseGuards(ApiKeyGuard)
export class RiderSyncController {
  constructor(@Inject(OfflineSyncService) private readonly sync: OfflineSyncService) {}

  @Get(':riderId/sync')
  @UseGuards(new ScopeGuard('rider:sync'))
  @ApiOperation({ summary: 'Pull pending commands for an offline rider' })
  @ApiParam({ name: 'riderId', description: 'The rider whose offline command queue is pulled.' })
  @ApiOkResponse({
    type: PullResultDto,
    description:
      "Every command still pending for this rider, in the server's total order — `createdAt`, " +
      'then `deviceSequence` to break ties. A command the server did not mention stays queued, ' +
      'so the device acks rather than assumes; `queueSize` and `capWarning` say how near the ' +
      'queue is to the cap.',
  })
  @ApiErrors()
  async pull(@Param('riderId') riderId: string, @Query() dto: PullDto): Promise<PullResultDto> {
    const since = dto.sinceSeq !== undefined ? Number(dto.sinceSeq) : undefined;
    const limit = dto.limit !== undefined ? Number(dto.limit) : undefined;
    return this.sync.pull(riderId, since, limit);
  }

  @Post(':riderId/sync/replay')
  @UseGuards(new ScopeGuard('rider:sync'))
  @HttpCode(200)
  @ApiOperation({
    summary: 'A device pushing its own offline commands back, in device order, exactly once each',
  })
  @ApiParam({ name: 'riderId', description: 'The rider whose device is replaying its commands.' })
  @ApiOkResponse({
    type: ReplayResultDto,
    description:
      "One outcome per command, in the order the server applied them — the device's `createdAt`, " +
      'tie-broken by `deviceSequence`. `duplicate` means that `(rider, deviceSequence)` was ' +
      'already submitted and `reason` carries what happened then; a command whose `expectedState` ' +
      'no longer matches is rejected with a reason, not applied. A batch that would overflow the ' +
      'queue is refused whole with 409 COMMAND_QUEUE_FULL, so nothing is half-applied and the ' +
      'device keeps everything to retry.',
  })
  @ApiBody({
    type: ReplayDto,
    description:
      "The device's day of work. The server re-sorts by `createdAt` then `deviceSequence` " +
      'regardless of the order sent, and dedupes on `(rider, deviceSequence)` — a re-sent batch ' +
      'converges on what the first one recorded.',
  })
  @ApiErrors()
  async replay(
    @Param('riderId') riderId: string,
    @Body() dto: ReplayDto,
  ): Promise<ReplayResultDto> {
    return this.sync.replay(
      riderId,
      dto.commands.map((command) => ({
        deviceSequence: command.deviceSequence,
        createdAt: new Date(command.createdAt),
        commandType: command.commandType,
        payload: command.payload,
        expectedState: command.expectedState ?? null,
      })),
    );
  }

  @Post(':riderId/sync/ack')
  @UseGuards(new ScopeGuard('rider:sync'))
  @ApiOperation({ summary: 'Acknowledge one queued command' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Dedupe key for the acknowledgement. Replaying the same key returns the outcome the ' +
      'first ack recorded rather than deciding again.',
  })
  @ApiParam({ name: 'riderId', description: 'The rider who owns the command being acknowledged.' })
  @ApiCreatedResponse({
    type: AckResultDto,
    description:
      'The verdict on the command, and the same verdict again if the key is replayed — an ' +
      'already-acked command comes back `already_delivered`, never a second delivery. A pending ' +
      'command whose `expectedState` no longer matches is recorded as `rejected` with a reason, ' +
      'never silently dropped.',
  })
  @ApiBody({ description: 'The id of the queued command being acknowledged.', type: AckDto })
  @ApiErrors()
  async ack(
    @Param('riderId') riderId: string,
    @Body() dto: AckDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<AckResultDto> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }
    const result = await this.sync.acknowledge(dto.commandId, riderId, idempotencyKey.trim(), {
      commandId: dto.commandId,
    });
    return { ...result, replayed: result.replayed ?? false };
  }
}
