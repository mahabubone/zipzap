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
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Observable, filter, map } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import { RateLimitGuard } from '../identity/rate-limit.guard.ts';
import { ApiErrors } from '../../common/api-errors.decorator.ts';
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
 *
 * A decorated class, not an interface: an interface is erased by TypeScript and `SwaggerModule`
 * cannot introspect one, which is how the highest-traffic route in the product came to respond
 * with no schema at all.
 */
/** The SSE event payload — one timeline step, pushed as it happens. */
export class PublicTrackingEventDto {
  @ApiProperty({
    example: 'ZZ-7F3K9Q2M',
    description: 'The tracking code this event belongs to.',
  })
  trackingCode!: string;

  @ApiProperty({
    example: 4,
    description:
      'Monotonic counter within a tracking code. NOT unique, so a client must not use it as a key.',
  })
  sequence!: number;

  @ApiProperty({
    example: 'OUT_FOR_DELIVERY',
    description: 'The event type, uppercase snake case.',
  })
  event!: string;

  @ApiProperty({
    example: '2026-10-10T11:42:00.000Z',
    description: 'ISO 8601 instant. The projection is eventually consistent with the live log.',
  })
  occurredAt!: string;
}

/** One entry in the timeline array on the tracking routes. */
export class PublicTimelineEventDto {
  @ApiProperty({
    example: 4,
    description:
      'Monotonic counter within a tracking code. NOT unique — see the ordering note on timelineFor — so a client must not use it as a key.',
  })
  sequence!: number;

  @ApiProperty({
    example: 'OUT_FOR_DELIVERY',
    description: 'The event type, uppercase snake case.',
  })
  event!: string;

  @ApiProperty({
    example: '2026-10-10T11:42:00.000Z',
    description: 'ISO 8601 instant. The projection is eventually consistent with the live log.',
  })
  occurredAt!: string;
}

export class PublicTrackingViewDto {
  @ApiProperty({ example: 'ZZ-7F3K9Q2M' })
  trackingCode!: string;

  @ApiProperty({
    example: 'OUT_FOR_DELIVERY',
    nullable: true,
    description: 'The latest event type. Null only when the timeline is empty, which 404s first.',
  })
  status!: string | null;

  @ApiProperty({
    type: PublicTimelineEventDto,
    isArray: true,
    description:
      'Ordered by sequence, then occurredAt, then id — a total order, because `sequence` alone is ' +
      'not one and `status` is read off the last row.',
  })
  timeline!: PublicTimelineEventDto[];
}

export type PublicTrackingView = PublicTrackingViewDto;

@ApiTags('tracking')
@Controller('track')
export class PublicTrackingController {
  constructor(
    @InjectDataSource('tracking') private readonly tracking: DataSource,
    @Inject(TrackingFanout) private readonly fanout: TrackingFanout,
  ) {}

  @Sse(':trackingCode/events')
  @UseGuards(new RateLimitGuard('public', false))
  @ApiOperation({
    summary: 'Live timeline events for one tracking code (SSE)',
    description:
      'Server-sent events. Emits the same shape as the timeline array on the tracking route, one ' +
      'event per message, filtered to this tracking code. Requires no credential. Each message ' +
      'is a `MessageEvent` whose `data` is the SSE event schema below.',
  })
  // `@ApiExtraModels` registers the schema. Without it the `$ref` below points at a schema nobody
  // declares, which is an unresolvable reference in the very document a client is generated from —
  // and only the spec test catches it, not the compiler.
  @ApiExtraModels(PublicTrackingEventDto)
  @ApiOkResponse({
    description:
      'A stream of `text/event-stream` messages. Each `data` payload is a PublicTrackingEventDto.',
    content: {
      'text/event-stream': { schema: { $ref: '#/components/schemas/PublicTrackingEventDto' } },
    },
  })
  @ApiBadRequestResponse({ description: 'The tracking code is malformed.' })
  @ApiTooManyRequestsResponse({ description: 'Rate limited. Honour `Retry-After`.' })
  @ApiParam({
    name: 'trackingCode',
    description: 'The tracking code whose events are streamed. Emits nothing until one occurs.',
  })
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
    description:
      'The strong form of the public route, for links sent in a message rather than printed on a ' +
      'label: 130 bits, so it cannot be walked. Resolves the shipment behind the link, then reads ' +
      'the same projection the code route reads. Rate limited identically.',
  })
  @ApiParam({
    name: 'token',
    description:
      'The 26-character token from the tracking link a customer is sent. Unknowable without it, so ' +
      'an unknown token gets the same 404 as a known one — this route is not a validity oracle.',
  })
  @ApiOkResponse({
    type: PublicTrackingViewDto,
    description:
      'The public timeline for the shipment the link names. Read from `public_timeline` rather than ' +
      'the tracking log, so the internal detail that must not be public is absent by construction ' +
      'rather than by a filter — and it can trail the live log by a beat, because a consumer builds ' +
      'it.',
  })
  @ApiErrors()
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
  @ApiOperation({
    summary: 'Public shipment tracking by tracking code',
    description:
      'The route every printed label and inbox link points at, so it is rate limited hard: enough ' +
      'to stop a walk, not enough to stop a customer. Codes are short enough to guess, which is why ' +
      'nothing a courier should not publish is in the projection it reads.',
  })
  @ApiParam({
    name: 'trackingCode',
    description: 'The ZZ- code printed on the label, e.g. ZZ-7F3K9Q2M.',
  })
  @ApiOkResponse({
    type: PublicTrackingViewDto,
    description:
      'The public timeline for that tracking code, or 404 when no shipment has it. Ordering is ' +
      'sequence, then occurredAt, then id, so it is stable across identical requests even though ' +
      '`sequence` alone is not unique — the last row of that order is what `status` reports.',
  })
  @ApiErrors()
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
