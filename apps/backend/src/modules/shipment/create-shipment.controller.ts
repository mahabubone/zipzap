/**
 * POST /v1/shipments — thin by design: validate, call one use case, return.
 *
 * Controllers never build an error response (the exception filter does that) and never touch a
 * repository (the use case owns the transaction). The only logic here is DTO validation, which is
 * a trust-boundary concern and belongs at the edge.
 */

import { Body, Controller, Headers, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { CreateShipmentService, type CreatedShipment } from './create-shipment.service.ts';
import { DuplicateRequestError } from '../../common/domain-error.ts';
import { money } from '../../common/money.ts';

export class AddressDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  // Stored E.164 per docs/domains/customer.md. Provider formatting happens in the adapter,
  // never here — +8801... is wrong for MiMSMS.
  @Matches(/^\+8801[3-9]\d{8}$/, { message: 'phone must be E.164, e.g. +8801700000000' })
  phone!: string;
  @IsString() @IsNotEmpty() @MaxLength(400) line!: string;
}

export class CreateShipmentDto {
  @IsString() @IsNotEmpty() @MaxLength(120) senderName!: string;
  @Matches(/^\+8801[3-9]\d{8}$/) senderPhone!: string;
  @IsString() @IsNotEmpty() @MaxLength(400) senderAddress!: string;

  @IsString() @IsNotEmpty() @MaxLength(120) recipientName!: string;
  @Matches(/^\+8801[3-9]\d{8}$/) recipientPhone!: string;
  @IsString() @IsNotEmpty() @MaxLength(400) recipientAddress!: string;

  @IsInt() @IsPositive() parcelWeightGrams!: number;
  @IsString() @IsNotEmpty() @MaxLength(200) parcelDescription!: string;

  /** Money as integer minor units. A decimal here is a bug, not a convenience. */
  @IsOptional() @IsInt() @IsPositive() codAmountMinor?: number;
  @IsOptional() @Matches(/^[A-Z]{3}$/) codCurrency?: string;

  @IsString() @MaxLength(80) zone!: string;
  @IsBoolean() remoteArea!: boolean;
  @IsBoolean() fragile!: boolean;
  @IsOptional() @IsString() @MaxLength(40) packagingKind?: string;
}

@ApiTags('shipments')
@Controller('v1/shipments')
@UseGuards(ApiKeyGuard)
export class CreateShipmentController {
  constructor(
    @Inject(CreateShipmentService) private readonly createShipment: CreateShipmentService,
  ) {}

  @Post()
  @UseGuards(new ScopeGuard('shipments:write'), new RateLimitGuard('merchant', true))
  @ApiOperation({ summary: 'Create a shipment' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(
    @Body() body: CreateShipmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<CreatedShipment & { replayed: boolean }> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      // Mandatory on this operation (ADR-0010): a retried create would duplicate the parcel.
      throw new DuplicateRequestError('Idempotency-Key header is required.');
    }

    const principal = request.principal!;
    const { result, replayed } = await this.createShipment.execute({
      // merchantId comes from the credential, never from the body.
      merchantId: principal.merchantId!,
      zone: body.zone,
      remoteArea: body.remoteArea,
      fragile: body.fragile,
      packagingKind: body.packagingKind ?? null,
      idempotencyKey: idempotencyKey.trim(),
      actorId: null,
      sender: { name: body.senderName, phone: body.senderPhone, line: body.senderAddress },
      recipient: {
        name: body.recipientName,
        phone: body.recipientPhone,
        line: body.recipientAddress,
      },
      parcel: {
        weightGrams: body.parcelWeightGrams,
        description: body.parcelDescription,
      },
      cod: money(body.codAmountMinor ?? 0, (body.codCurrency ?? 'BDT') as 'BDT'),
    });

    return { ...result, replayed };
  }
}
