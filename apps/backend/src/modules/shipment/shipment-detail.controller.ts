/**
 * GET /v1/shipments/:id + POST /v1/shipments/:id/cancel — one parcel, own merchant only.
 *
 * Both read through the same tenant gate: a stranger's id 404s (a 403 would confirm
 * the shipment exists — an enumeration oracle). Cancel follows the
 * AdvanceDeliveryService shape: lock, assert, save, emit — and the machine rejects
 * cancelling a DELIVERED parcel, because that is a return, not a cancel.
 */

import { Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ApiKeyGuard, ScopeGuard, type AuthenticatedRequest } from '../identity/api-key.guard.ts';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import { CancelShipmentService, type CancelledShipment } from './cancel-shipment.service.ts';

interface ShipmentDetail {
  readonly id: string;
  readonly trackingCode: string;
  readonly status: string;
  readonly merchantReference: string | null;
  readonly senderName: string;
  readonly senderPhone: string;
  readonly recipientName: string;
  readonly recipientPhone: string;
  readonly parcelWeightGrams: number;
  readonly parcelDescription: string;
  readonly codAmountMinor: number;
  readonly codCurrency: string;
  readonly pricingVersion: number;
  readonly createdAt: string;
}

@ApiTags('shipments')
@Controller('v1/shipments')
@UseGuards(ApiKeyGuard)
export class ShipmentDetailController {
  constructor(
    @InjectDataSource('shipment') private readonly shipments: DataSource,
    @Inject(CancelShipmentService) private readonly cancel: CancelShipmentService,
  ) {}

  private merchantId(request: AuthenticatedRequest): string {
    return request.principal!.merchantId!;
  }

  @Get(':id')
  @UseGuards(new ScopeGuard('shipments:read'), new RateLimitGuard('merchant', false))
  @ApiOperation({ summary: 'Get one of your shipments' })
  async detail(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<ShipmentDetail> {
    const merchantId = this.merchantId(request);
    const rows = await this.shipments.query(
      `SELECT id, tracking_code, status, merchant_reference, sender_name, sender_phone,
              recipient_name, recipient_phone, parcel_weight_grams, parcel_description,
              cod_amount_minor, cod_currency, pricing_version, created_at
         FROM shipment.shipments WHERE id = $1 AND merchant_id = $2`,
      [id, merchantId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new ResourceNotFoundError('Shipment not found.');
    return {
      id: String(row.id),
      trackingCode: String(row.tracking_code),
      status: String(row.status),
      merchantReference: (row.merchant_reference as string | null) ?? null,
      senderName: String(row.sender_name),
      senderPhone: String(row.sender_phone),
      recipientName: String(row.recipient_name),
      recipientPhone: String(row.recipient_phone),
      parcelWeightGrams: Number(row.parcel_weight_grams),
      parcelDescription: String(row.parcel_description),
      codAmountMinor: Number(row.cod_amount_minor),
      codCurrency: String(row.cod_currency),
      pricingVersion: Number(row.pricing_version),
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  @Post(':id/cancel')
  @UseGuards(new ScopeGuard('shipments:write'), new RateLimitGuard('merchant', true))
  @ApiOperation({ summary: 'Cancel a shipment that has not shipped yet' })
  async cancelShipment(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<CancelledShipment> {
    return this.cancel.execute(this.merchantId(request), id);
  }
}
