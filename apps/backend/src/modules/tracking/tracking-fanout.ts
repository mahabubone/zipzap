/**
 * SseFanout — the process-local bridge between the tracking consumer and
 * Server-Sent Events streams. The consumer publishes after the projection
 * commits; SSE clients subscribe to the public codes they track.
 *
 * Ponytail: process-local. GET /track/:trackingCode/events fans out from events
 * consumed in THIS process only. When the API and the eventing worker move to
 * separate machines, replace the Subject's next() with a Redis pub/sub or NATS
 * core subscription — the publish/subscribe seam stays the same.
 */

import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface TrackingFanoutEvent {
  readonly trackingCode: string;
  readonly sequence: number;
  readonly event: string;
  readonly occurredAt: string;
}

@Injectable()
export class TrackingFanout {
  private readonly subject = new Subject<TrackingFanoutEvent>();

  publish(event: TrackingFanoutEvent): void {
    this.subject.next(event);
  }

  observable(): Subject<TrackingFanoutEvent> {
    return this.subject;
  }
}
