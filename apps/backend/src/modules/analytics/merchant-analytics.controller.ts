/**
 * GET /v1/analytics/merchant — your own daily series: parcels and money.
 *
 * The endpoint the `network:read` scope comment points a merchant at. Until cod_summary was
 * merchant-scoped (migration `0047`) there was nothing to point them at: the control-tower report
 * answered for every account, so the honest options were "read your neighbour's money" or "read
 * nothing". This is the second one, scoped.
 *
 * No merchant id in the path or the query, for the reason `merchant-balance.controller.ts` gives:
 * there is nothing here to tamper with, because the id comes from the credential. `cod:read` is the
 * scope — the same permission that already guards a merchant's COD records.
 */

import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { ApiExtraModels, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { ProjectionQueriesService } from './projection-queries.service.ts';

/** Days of history when the caller names no range. */
const DEFAULT_WINDOW_DAYS = 30;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export class MerchantAnalyticsQuery {
  /** Inclusive Asia/Dhaka day bucket, yyyy-mm-dd. Defaults: 30 days ago. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be yyyy-mm-dd' })
  from?: string;

  /** Inclusive Asia/Dhaka day bucket, yyyy-mm-dd. Defaults: today. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be yyyy-mm-dd' })
  to?: string;
}

/**
 * One day of the merchant's own series: parcels and money.
 *
 * Money crosses as `string` on purpose — `expectedMinor` is poisha and a figure above 2^53 loses
 * precision as a JSON number. `currency` is null on a day the parcel side saw and the money side
 * did not (no COD deliveries), which is not the same as zero money in a known currency.
 */
export class MerchantDayPointDto {
  @ApiProperty({ example: '2026-10-09', description: 'Asia/Dhaka day bucket' })
  day!: string;

  @ApiProperty({ example: 42, description: 'Shipments created that day' })
  shipmentsCreated!: number;

  @ApiProperty({ example: 38, description: 'Parcels picked up that day' })
  pickedUp!: number;

  @ApiProperty({ example: 31, description: 'Parcels delivered that day' })
  delivered!: number;

  @ApiProperty({
    example: 'BDT',
    nullable: true,
    description: 'Null when no COD was recorded that day',
  })
  currency!: string | null;

  @ApiProperty({
    example: '1250500',
    description: 'Expected COD in minor units (poisha), as a string',
  })
  expectedMinor!: string;

  @ApiProperty({
    example: '900000',
    description: 'Collected COD in minor units (poisha), as a string',
  })
  collectedMinor!: string;

  @ApiProperty({
    example: '700000',
    description: 'Settled COD in minor units (poisha), as a string',
  })
  settledMinor!: string;
}

/** The merchant's own daily series — the response shape, declared so Swagger can emit it. */
export class MerchantSeriesDto {
  @ApiProperty({
    example: '2026-09-10',
    description: 'First day of the requested window, inclusive',
  })
  from!: string;

  @ApiProperty({
    example: '2026-10-09',
    description: 'Last day of the requested window, inclusive',
  })
  to!: string;

  @ApiProperty({ type: MerchantDayPointDto, isArray: true })
  days!: readonly MerchantDayPointDto[];
}

@ApiTags('analytics')
@Controller('v1/analytics')
@UseGuards(ApiKeyGuard)
export class MerchantAnalyticsController {
  constructor(
    @Inject(ProjectionQueriesService)
    private readonly projections: ProjectionQueriesService,
  ) {}

  @ApiErrors()
  @Get('merchant')
  @UseGuards(new ScopeGuard('cod:read'))
  @ApiOperation({ summary: 'Your own daily parcel counts and COD money, one point per day' })
  @ApiOkResponse({ type: MerchantSeriesDto, description: 'One point per day, oldest first' })
  @ApiExtraModels(MerchantSeriesDto, MerchantDayPointDto)
  async mine(
    @Req() request: AuthenticatedRequest,
    @Query() query: MerchantAnalyticsQuery,
  ): Promise<MerchantSeriesDto> {
    const to = query.to ?? isoDaysAgo(0);
    const from = query.from ?? isoDaysAgo(DEFAULT_WINDOW_DAYS);
    return this.projections.merchantSeries(request.principal!.merchantId!, from, to);
  }
}
