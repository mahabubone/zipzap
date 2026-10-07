/**
 * GET /track/:trackingCode — public, no account.
 *
 * Reads the purpose-built `public_timeline` projection, never `tracking.events`. The fields that
 * must not be public are absent from that table, so there is no filter here to get wrong.
 *
 * Eventual consistency is intended and stated: the authoritative log is written in the state
 * transaction, this projection is built by the consumer a beat later.
 */

import { Controller, Get, Inject, NotFoundException, Param, Sse, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Observable, filter, map } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { TrackingFanout } from './tracking-fanout.ts';

interface TimelineRow {
  sequence: number;
  event_type: string;
  occurred_at: Date;
}

@ApiTags('tracking')
@Controller('track')
export class PublicTrackingController {
  constructor(
    @InjectDataSource('tracking') private readonly tracking: DataSource,
    @Inject(TrackingFanout) private readonly fanout: TrackingFanout,
  ) {}

  @Sse(':trackingCode/events')
  @UseGuards(new RateLimitGuard('public', false))
  @ApiOperation({ summary: 'Live timeline events for one tracking code (SSE)' })
  events(@Param('trackingCode') trackingCode: string): Observable<MessageEvent> {
    return this.fanout.observable().pipe(
      filter((event) => event.trackingCode === trackingCode),
      map((event) => ({
        data: {
          sequence: event.sequence,
          event: event.event,
          occurredAt: event.occurredAt,
        },
      })),
    );
  }

  @Get(':trackingCode')
  @UseGuards(new RateLimitGuard('public', false))
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
