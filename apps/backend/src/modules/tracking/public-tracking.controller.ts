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
  tracking_code: string;
  sequence: number;
  event_type: string;
  occurred_at: Date;
}

/**
 * The public projection's shape. Declared here rather than inlined so the two routes that return it
 * cannot drift, and so `api-client` has a stable thing to generate from.
 */
export interface PublicTrackingView {
  trackingCode: string;
  status: string | null;
  timeline: { sequence: number; event: string; occurredAt: string }[];
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

  /**
   * GET /track/token/:token — the unguessable form.
   *
   * Additive, not a cut-over. `/track/:trackingCode` keeps working because those links are already in
   * customers' inboxes and in printed labels; replacing the route would break every one of them to fix
   * a problem that only exists for *new* links.
   *
   * Rate-limited identically to the code route, and the token is 130 bits — so this is not a weaker
   * endpoint than the one it sits beside, it is a stronger one that the public limit can no longer
   * meaningfully bound. The limit still exists, because it still bounds *this* route's aggregate cost.
   */
  @Get('token/:token')
  @UseGuards(new RateLimitGuard('public', false))
  @ApiOperation({
    summary: 'Public tracking by unguessable token (26 chars, 130 bits) — not enumerable',
  })
  async trackByToken(@Param('token') token: string): Promise<PublicTrackingView> {
    const rows: Array<{ shipment_id: string }> = await this.tracking.query(
      `SELECT shipment_id FROM tracking.public_tokens WHERE token = $1`,
      [token],
    );
    const shipmentId = rows[0]?.shipment_id;
    // 404 for an unknown token, identical to the code route's 404. A token that exists and one that
    // does not must be indistinguishable, or the route becomes a validity oracle for tokens.
    if (!shipmentId) throw new NotFoundException('No shipment exists for that tracking link.');

    return this.viewFor(shipmentId);
  }

  @Get(':trackingCode')
  @UseGuards(new RateLimitGuard('public', false))
  @ApiOperation({ summary: 'Public shipment tracking by tracking code' })
  async track(@Param('trackingCode') trackingCode: string): Promise<PublicTrackingView> {
    const rows: TimelineRow[] = await this.timelineFor(trackingCode);
    return this.viewFromTimeline(trackingCode, rows);
  }

  /** Resolved by token, then read by id — the projection is keyed by code, and code is not knowable
   *  from a token without reading the shipment table. One extra narrow query beats breaking the rule. */
  private async viewFor(shipmentId: string): Promise<PublicTrackingView> {
    const rows: TimelineRow[] = await this.timelineFor(undefined, shipmentId);
    const code = rows[0]?.tracking_code;
    if (!code) throw new NotFoundException('No shipment exists for that tracking link.');
    return this.viewFromTimeline(code, rows);
  }

  /**
   * `sequence` alone does not order these rows.
   *
   * The consumer allocates it as `MAX(sequence) + 1` inside its own transaction, with nothing
   * holding a lock on the tracking code — so two events projected concurrently both read the same
   * maximum and both write the same next number. That is a lost update, and it has left real
   * duplicate sequences in this table.
   *
   * So `ORDER BY sequence` is a partial order: Postgres may return tied rows in any order it likes,
   * and does not return them the same way twice. Two identical requests to this route produced the
   * same rows in two different orders — and because `status` is read off the last row, one parcel
   * reported two different current states.
   *
   * `occurred_at` then `id` makes the read deterministic without pretending the sequence is unique.
   * The allocation race itself is a separate fix: a unique index cannot be added while duplicates
   * exist, and rule 8 forbids tidying history by editing rows, so it is reported rather than
   * silently patched here.
   */
  private async timelineFor(trackingCode?: string, shipmentId?: string): Promise<TimelineRow[]> {
    if (shipmentId !== undefined) {
      return this.tracking.query(
        `SELECT tracking_code, sequence, event_type, occurred_at
           FROM tracking.public_timeline
          WHERE shipment_id = $1
          ORDER BY sequence, occurred_at, id`,
        [shipmentId],
      );
    }
    return this.tracking.query(
      `SELECT tracking_code, sequence, event_type, occurred_at
         FROM tracking.public_timeline
        WHERE tracking_code = $1
        ORDER BY sequence, occurred_at, id`,
      [trackingCode],
    );
  }

  private viewFromTimeline(trackingCode: string, rows: TimelineRow[]): PublicTrackingView {
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
