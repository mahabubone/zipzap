/**
 * CodLookup — the returns boundary's read contract.
 *
 * One method: a shipment id in, what was actually collected out. The return
 * service needs the collected amount to emit the reversal, and the module
 * boundary says it must not open the cod connection directly — so it calls
 * this, and nothing else.
 *
 * Returns null for a shipment with no collection (never collected, or zero-COD).
 * The caller treats that as "nothing to reverse", never as zero to invent.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { CodRecordRepository } from './cod-record.repository.ts';

export const COD_LOOKUP = Symbol('COD_LOOKUP');

@Injectable()
export class CodLookup {
  constructor(
    @InjectDataSource('cod') private readonly cod: DataSource,
    @Inject(CodRecordRepository) private readonly records: CodRecordRepository,
  ) {}

  async findCollected(
    shipmentId: string,
  ): Promise<{ collectedMinor: number; currency: string; merchantId: string } | null> {
    return this.cod.transaction(async (manager) => {
      const record = await this.records.findByShipmentId(manager, shipmentId);
      if (!record || record.collectedMinor === null) return null;
      return {
        collectedMinor: Number(record.collectedMinor),
        currency: record.currency,
        merchantId: record.merchantId,
      };
    });
  }
}
