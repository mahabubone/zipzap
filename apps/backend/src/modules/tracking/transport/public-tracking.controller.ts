/**
 * GET /track/:trackingCode — public, no account.
 *
 * Reads the purpose-built `public_timeline` projection, never `tracking.events`. The fields that
 * must not be public are absent from that table, so there is no filter here to get wrong.
 *
 * Eventual consistency is intended and stated: the authoritative log is written in the state
 * transaction, this projection is built by the consumer a beat later.
 */

import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

interface TimelineRow {
  sequence: number;
  event_type: string;
  occurred_at: Date;
}

@ApiTags('tracking')
@Controller('track')
export class PublicTrackingController {
  constructor(@InjectDataSource('tracking') private readonly tracking: DataSource) {}

  @Get(':trackingCode')
  @ApiOperation({ summary: 'Public shipment tracking' })
  async track(@Param('trackingCode') trackingCode: string): Promise<{
    trackingCode: string;
    status: string | null;
    timeline: { sequence: number; event: string; occurredAt: string }[];
  }> {
    const rows: TimelineRow[] = await this.tracking.query(
      `SELECT sequence, event_type, occurred_at
         FROM tracking.public_timeline
        WHERE tracking_code = $1
        ORDER BY sequence`,
      [trackingCode],
    );

    if (rows.length === 0) {
      throw new NotFoundException('No shipment exists for that tracking code.');
    }

    const latest = rows[rows.length - 1];
    return {
      trackingCode,
      status: latest?.event_type ?? null,
      timeline: rows.map((row) => ({
        sequence: row.sequence,
        event: row.event_type,
        occurredAt: new Date(row.occurred_at).toISOString(),
      })),
    };
  }
}
