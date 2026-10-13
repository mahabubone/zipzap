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
import { ResourceNotFoundError } from '../../common/domain-error.ts';
import type { DataSource } from 'typeorm';
import {
  estimateDelivery as computeEstimate,
  dateKey,
  type Holiday,
  type ZoneCutoffs,
} from './rules/sla.js';

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

/** Timezone- and holiday-aware SLA estimate for a zone (Phase 5 rung 3). */
export interface SLAEstimate {
  readonly zone: string;
  /** `yyyy-mm-dd` in Asia/Dhaka — the parcel is due by end of this date. */
  readonly estimatedDate: string;
  readonly businessDaysInFlight: number;
  readonly pickupShifted: boolean;
  readonly skippedHolidays: string[];
}

@Injectable()
export class NetworkService {
  constructor(@InjectDataSource('network') private readonly network: DataSource) {}

  /**
   * Every serviceable zone, for a picker.
   *
   * A console must not hardcode this list: zones are network configuration, they
   * change, and a stale hardcoded list offers a merchant a zone that was
   * retired and hides one that was added. This reads `network`'s own table, so
   * it is a plain read and not a cross-schema join (rule 2).
   */
  async listServiceableZones(): Promise<string[]> {
    const rows = await this.network.query(
      `SELECT zone FROM network.service_areas WHERE serviceable ORDER BY zone`,
    );
    return rows.map((r: { zone: string }) => r.zone);
  }

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

  /**
   * Timezone- and holiday-aware delivery estimate for a zone. Asia/Dhaka wall-clock time;
   * holidays (network.holidays) and cutoffs (network.zone_cutoffs) come from the coverage
   * data, never from a hardcoded city check. `now` defaults to the current moment — pass a
   * fixed date in tests.
   */
  async estimateDelivery(zone: string, now: Date = new Date()): Promise<SLAEstimate> {
    const coverage = await this.checkZone(zone);
    if (!coverage.serviceable) {
      throw new ResourceNotFoundError(`Zone "${zone}" is not serviceable.`);
    }
    if (coverage.estimatedDays === null) {
      throw new ResourceNotFoundError(`No SLA estimated_days for zone "${zone}".`);
    }

    const cutoffs = await this.cutoffsForZone(zone);
    const holidays = await this.holidays();

    const result = computeEstimate(now, coverage.estimatedDays, holidays, cutoffs);
    return {
      zone: coverage.zone,
      estimatedDate: dateKey(result.estimatedDate),
      businessDaysInFlight: result.businessDaysInFlight,
      pickupShifted: result.pickupShifted,
      skippedHolidays: [...result.skippedHolidays],
    };
  }

  /** Holidays ordered by date,
      estimatedDate: dateKey(result.estimatedDate),
      businessDaysInFlight: result.businessDaysInFlight,
      pickupShifted: result.pickupShifted,
      skippedHolidays: [...result.skippedHolidays],
    };
  }

  /** Holidays ordered by date (stable reading for the same transaction).
      `date::text` normalizes Postgres's DATE parsing (which can return a timezone-adjusted
      Date) into a clean yyyy-mm-dd string for comparison against the rule's dateKey. */
  private async holidays(): Promise<readonly Holiday[]> {
    const rows = await this.network.query(
      `SELECT date::text AS date, reason FROM network.holidays ORDER BY date`,
    );
    return rows as unknown as Holiday[];
  }

  private async cutoffsForZone(zone: string): Promise<ZoneCutoffs> {
    const rows = await this.network.query(
      `SELECT zone, pickup_cutoff, delivery_cutoff FROM network.zone_cutoffs WHERE zone = $1`,
      [zone],
    );
    const row = rows[0] as
      { zone: string; pickup_cutoff: string | null; delivery_cutoff: string | null } | undefined;
    return row
      ? { zone, pickupCutoff: row.pickup_cutoff, deliveryCutoff: row.delivery_cutoff }
      : { zone, pickupCutoff: null, deliveryCutoff: null };
  }
}
