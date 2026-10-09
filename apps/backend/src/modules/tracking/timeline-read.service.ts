/**
 * Merchant-scoped timeline read.
 *
 * The authoritative log is `tracking.events`, and this service reads it — which
 * is exactly why it lives HERE and not in the shipment module. Rule 2: a module
 * owns its schema, so the shipment detail screen cannot JOIN the log or SELECT
 * it; it asks, through an injected service, the way every other cross-module
 * read in this codebase happens.
 *
 * This is deliberately NOT the public projection. `GET /track/:trackingCode`
 * reads `public_timeline`, a table that does not contain the actor or the
 * metadata — those fields are absent rather than filtered, so there is no filter
 * here to get wrong. A merchant legitimately needs them: which hub, which
 * rider, what a scan said. A recipient does not, and must never see them.
 *
 * Authorisation is deliberately NOT here. The caller has already resolved the
 * shipment inside its own schema and confirmed the merchant owns it; this
 * service is handed a shipment id it is being asked about. Re-checking would
 * mean reading `shipment.shipments` from the tracking module, which is the same
 * rule violation in the other direction.
 */

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

export interface TimelineEntry {
  readonly eventType: string;
  readonly occurredAt: string;
  /** `human` | `system` | `rider` — who caused it, not who they are. */
  readonly actorType: string;
  /** Hub, rider or scan detail. Never PII: the writer does not put any there. */
  readonly metadata: Readonly<Record<string, unknown>>;
  /** A correction supersedes an earlier row rather than editing it (rule 8). */
  readonly correctsEventId: string | null;
}

@Injectable()
export class TimelineReadService {
  constructor(@InjectDataSource('tracking') private readonly tracking: DataSource) {}

  /**
   * Oldest first — a timeline read newest-first is a list, not a timeline.
   *
   * Bounded on purpose. The log is append-only and grows forever; a detail
   * screen that renders every correction to every scan since 2024 is a page
   * nobody waits for. ponytail: a fixed cap rather than pagination — the
   * timeline a merchant reads is "what happened to this parcel", which is the
   * recent end. Add paging when a dispute ever needs the full history.
   */
  async forShipment(shipmentId: string, limit = 100): Promise<ReadonlyArray<TimelineEntry>> {
    const rows: Array<{
      event_type: string;
      occurred_at: Date;
      actor_type: string;
      metadata: Record<string, unknown>;
      corrects_event_id: string | null;
    }> = await this.tracking.query(
      `SELECT event_type, occurred_at, actor_type, metadata, corrects_event_id
         FROM tracking.events
        WHERE shipment_id = $1
        ORDER BY occurred_at DESC, id DESC
        LIMIT $2`,
      [shipmentId, limit],
    );

    // Reversed after the query so the LIMIT keeps the RECENT end. Taking the
    // oldest 100 of a 5,000-event log would show a parcel that looks like it
    // never moved.
    return rows.reverse().map((row) => ({
      eventType: row.event_type,
      occurredAt: new Date(row.occurred_at).toISOString(),
      actorType: row.actor_type,
      metadata: row.metadata ?? {},
      correctsEventId: row.corrects_event_id ?? null,
    }));
  }
}
