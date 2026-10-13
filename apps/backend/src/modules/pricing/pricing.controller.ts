/**
 * Pricing's HTTP surface: a quote, and a card you can read.
 *
 * Both are side-effect free, so neither takes an Idempotency-Key. A quote changes nothing and
 * quoting twice with the same inputs returns the same quote by determinism, not by dedupe.
 */

import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
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
import { ApiKeyGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
import { QuoteResponseDto, RateCardResponseDto } from './pricing-response.dto.ts';
import { PricingService } from './pricing.service.ts';
import type { Currency } from '../../common/money.ts';

export class QuoteDto {
  @IsInt()
  @Min(1)
  weightGrams!: number;

  @IsInt()
  @Min(0)
  @ApiProperty({
    type: 'integer',
    description: 'Cash on delivery, in integer minor units (poisha). Zero means no COD.',
  })
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
  @ApiBody({
    type: QuoteDto,
    description:
      'The shipment facts that change the price: weight, the cash the rider would collect, the zone, ' +
      'and the surcharge flags. The merchant plan is read from the credential and cannot be named ' +
      'here, so a caller cannot quote themselves a better plan.',
  })
  @ApiCreatedResponse({
    type: QuoteResponseDto,
    description:
      'An itemised quote priced against exactly one frozen version, with `total` the sum of the lines ' +
      'in integer minor units including the COD fee and tax, minus the plan discount. Nothing is ' +
      'written and quoting twice with the same inputs returns the same numbers; keep `version` — it is ' +
      'the version a shipment is charged against, and the evidence a later dispute is settled on.',
  })
  @ApiErrors()
  async quote(
    @Body() body: QuoteDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<QuoteResponseDto> {
    return this.pricing.quote({
      weightGrams: body.weightGrams,
      codAmountMinor: body.codAmountMinor,
      zone: body.zone,
      remoteArea: body.remoteArea,
      fragile: body.fragile,
      packagingKind: body.packagingKind ?? null,
      currency: body.currency,
      version: body.version,
      // The plan comes from the credential's merchant, never from the body. It used to be a body
      // field, which meant a caller could name the plan with the best discount and be quoted it.
      merchantId: request.principal!.merchantId!,
    });
  }

  @Get('rate-card')
  @ApiOperation({ summary: 'Your rate card, with worked examples' })
  @ApiOkResponse({
    type: RateCardResponseDto,
    description:
      "This merchant's own active card: the frozen version it was read from, the plan they are on, " +
      'every fee and rate as integer minor units or basis points, and four worked examples so the ' +
      'card can be read without holding a parcel in the hand. Read-only.',
  })
  @ApiErrors()
  async rateCard(@Req() request: AuthenticatedRequest): Promise<RateCardResponseDto> {
    return this.pricing.rateCard(request.principal!.merchantId!);
  }
}
