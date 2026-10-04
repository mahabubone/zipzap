/**
 * ShipmentLookup — the tracking boundary's read contract.
 *
 * One method: a shipment id in, its tracking code out. The consumer project timeline rows
 * against codes it cannot read from any other table, and the module boundary says it must
 * not open the shipment connection directly — so it calls this, and nothing else.
 *
 * Returns null for an unknown id. The consumer treats that as ignorable, not fatal.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ShipmentRepository } from './shipment.repository.ts';

export const SHIPMENT_LOOKUP = Symbol('SHIPMENT_LOOKUP');

@Injectable()
export class ShipmentLookup {
  constructor(
    @InjectDataSource('shipment') private readonly shipmentDataSource: DataSource,
    @Inject(ShipmentRepository) private readonly shipments: ShipmentRepository,
  ) {}

  async findTrackingCode(shipmentId: string): Promise<string | null> {
    return this.shipmentDataSource.transaction(async (manager) => {
      return this.shipments.findTrackingCode(manager, shipmentId);
    });
  }

  async findCodAmount(
    shipmentId: string,
  ): Promise<{ amountMinor: number; currency: string } | null> {
    return this.shipmentDataSource.transaction(async (manager) => {
      return this.shipments.findCodAmount(manager, shipmentId);
    });
  }

  /**
   * The webhook boundary's read: a shipment id in, its owning merchant out. Delivery
   * events carry the parcel, not the merchant — but webhook endpoints are per
   * merchant, so the fan-out needs the owner. Same contract shape as the reads
   * above; null means unknown, and the caller treats that as ignorable.
   */
  async findMerchantId(shipmentId: string): Promise<string | null> {
    return this.shipmentDataSource.transaction(async (manager) => {
      return this.shipments.findMerchantId(manager, shipmentId);
    });
  }
}
