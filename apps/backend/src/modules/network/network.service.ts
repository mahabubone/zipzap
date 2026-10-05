/**
 * NetworkService — the serviceability contract other modules consume.
 *
 * Reads own schema only, exports a service (ADR-0002: injected service, not a
 * table access). The answer comes from coverage rows — absence of a row is a
 * `serviceable: false` with the zone named in the reason, never a default-allow
 * and never a hardcoded city check.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

export interface CoverageCheck {
  readonly zone: string;
  readonly serviceable: boolean;
  /** null when serviceable; a sentence for a human when not. */
  readonly reason: string | null;
  readonly estimatedDays: number | null;
  readonly pickupAvailable: boolean;
  readonly deliveryAvailable: boolean;
  readonly codAvailable: boolean;
}

@Injectable()
export class NetworkService {
  constructor(@InjectDataSource('network') private readonly network: DataSource) {}

  async checkZone(zone: string): Promise<CoverageCheck> {
    const rows = await this.network.query(
      `SELECT zone, serviceable, estimated_days, pickup_available, delivery_available, cod_available
         FROM network.service_areas WHERE zone = $1`,
      [zone],
    );
    const row = rows[0] as
      | {
          zone: string;
          serviceable: boolean;
          estimated_days: number | null;
          pickup_available: boolean;
          delivery_available: boolean;
          cod_available: boolean;
        }
      | undefined;

    if (!row) {
      return {
        zone,
        serviceable: false,
        reason: `No coverage for zone "${zone}".`,
        estimatedDays: null,
        pickupAvailable: false,
        deliveryAvailable: false,
        codAvailable: false,
      };
    }

    return {
      zone: row.zone,
      serviceable: row.serviceable,
      reason: row.serviceable ? null : `Zone "${row.zone}" is not serviceable.`,
      estimatedDays: row.estimated_days,
      pickupAvailable: row.pickup_available,
      deliveryAvailable: row.delivery_available,
      codAvailable: row.cod_available,
    };
  }
}
