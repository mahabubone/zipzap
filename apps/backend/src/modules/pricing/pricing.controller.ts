/**
 * POST /v1/pricing/quote — thin by design: validate, call one use case, return.
 *
 * Read-only and side-effect free, so no Idempotency-Key: a quote changes nothing, and quoting
 * twice with the same inputs returns the same quote by determinism, not by dedupe.
 */

import { Body, Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiKeyGuard } from '../identity/api-key.guard.ts';
import { PricingService } from './pricing.service.ts';
import type { Currency } from '../../common/money.ts';
import type { Quote } from './rules/pricing.ts';

export class QuoteDto {
  @IsInt()
  @Min(1)
  weightGrams!: number;

  @IsInt()
  @Min(0)
  codAmountMinor!: number;

  @IsString()
  @MaxLength(80)
  zone!: string;

  @IsBoolean()
  remoteArea!: boolean;

  @IsBoolean()
  fragile!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  packagingKind?: string;

  @IsString()
  @MaxLength(40)
  merchantPlan!: string;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  currency?: Currency;

  @IsOptional()
  @IsInt()
  @IsPositive()
  version?: number;
}

@ApiTags('pricing')
@Controller('v1/pricing')
@UseGuards(ApiKeyGuard)
export class PricingController {
  constructor(@Inject(PricingService) private readonly pricing: PricingService) {}

  @Post('quote')
  @ApiOperation({ summary: 'Quote a shipment price' })
  async quote(@Body() body: QuoteDto): Promise<Quote> {
    return this.pricing.quote({
      weightGrams: body.weightGrams,
      codAmountMinor: body.codAmountMinor,
      zone: body.zone,
      remoteArea: body.remoteArea,
      fragile: body.fragile,
      packagingKind: body.packagingKind ?? null,
      merchantPlan: body.merchantPlan,
      currency: body.currency,
      version: body.version,
    });
  }
}
