/**
 * The Rider client runtime: connects the offline queue to the backend API.
 *
 * Implements the full lifecycle:
 * 1. Queue local action (pickup scan, delivery, attempt, COD) offline
 * 2. If online: flush outbound queue via replayRiderSync
 * 3. Receive rulings and reconcile the device queue
 *
 * Every `record*` method only ever appends to the queue — it never calls the
 * network directly. That is the whole point of ADR-0012: the action is accepted
 * into the local queue with a monotonic `deviceSequence` and applied later, in
 * order, exactly once, when `sync()` runs. A screen that queued a scan and then
 * lost signal has not lost the scan.
 */

import { OfflineQueue, type QueueStorage, type Settled } from './offline/command-queue.ts';
import { ZipZapClient } from '@zipzap/api-client';

export interface RiderSession {
  riderId: string;
  token?: string;
  apiKey?: string;
}

export class RiderClient {
  readonly queue: OfflineQueue;
  readonly client: ZipZapClient;
  readonly riderId: string;

  constructor(storage: QueueStorage, session: RiderSession, baseUrl = 'http://localhost:3000') {
    this.riderId = session.riderId;
    this.queue = new OfflineQueue(storage);
    this.client = new ZipZapClient({
      baseUrl,
      bearerToken: session.token,
      apiKey: session.apiKey,
    });
  }

  /**
   * Queue a delivery completion. The `shipmentStatus` in `expectedState` is
   * what the device believed; the server replays it against the shipment's
   * real status and rejects (with a reason) if the parcel was cancelled or
   * delivered by someone else while the phone was offline.
   */
  async recordDelivery(shipmentId: string, expectedStatus = 'OUT_FOR_DELIVERY') {
    return this.queue.append({
      commandType: 'zipzap.rider.delivery',
      payload: { shipmentId },
      expectedState: { shipmentId, shipmentStatus: expectedStatus },
    });
  }

  /**
   * Queue a pickup scan. Pickup has no shipment-state validator server-side, so
   * `expectedState` records what the device saw and the command applies
   * unconditionally on replay.
   */
  async recordPickup(pickupJobId: string, shipmentId: string) {
    return this.queue.append({
      commandType: 'zipzap.rider.pickup',
      payload: { pickupJobId, shipmentId },
      expectedState: { shipmentId, status: 'PICKUP_ASSIGNED' },
    });
  }

  /**
   * Queue a failed delivery attempt. `reason` is the closed vocabulary the
   * server enforces (CUSTOMER_UNAVAILABLE, WRONG_ADDRESS, ...); the retryable
   * ones schedule a retry, the terminal ones hand the parcel to returns.
   */
  async recordDeliveryAttempt(jobId: string, shipmentId: string, reason: string, note?: string) {
    return this.queue.append({
      commandType: 'zipzap.rider.delivery',
      payload: { jobId, reason, note: note ?? null },
      expectedState: { shipmentId, shipmentStatus: 'OUT_FOR_DELIVERY' },
    });
  }

  /**
   * Queue a COD collection. `collectedMinor` is integer minor units (poisha),
   * never a decimal — the server reconciles it against the frozen quote and
   * records a shortfall rather than overwriting the promise.
   */
  async recordCodCollection(shipmentId: string, collectedMinor: number) {
    return this.queue.append({
      commandType: 'zipzap.rider.delivery',
      payload: { shipmentId, collectedMinor },
      expectedState: { shipmentId, shipmentStatus: 'OUT_FOR_DELIVERY' },
    });
  }

  /**
   * Flush the offline queue to the server.
   *
   * Replays in creation order, reconciles rulings, keeps rejected reasons.
   */
  async sync(): Promise<{
    sent: number;
    settled: readonly Settled[];
    queueRemaining: number;
    capWarning: boolean;
  }> {
    const outbound = await this.queue.outbound();
    if (outbound.length === 0) {
      return {
        sent: 0,
        settled: await this.queue.settled(),
        queueRemaining: (await this.queue.pending()).length,
        capWarning: await this.queue.capWarning(),
      };
    }

    const payload = outbound.map((cmd) => ({
      deviceSequence: cmd.deviceSequence,
      createdAt: cmd.createdAt,
      commandType: cmd.commandType,
      payload: cmd.payload,
      expectedState: cmd.expectedState,
    }));

    const response = await this.client.replayRiderSync(this.riderId, payload);

    await this.queue.reconcile(
      response.results.map(
        (r: {
          deviceSequence: number;
          kind: 'applied' | 'rejected' | 'duplicate';
          reason: string | null;
        }) => {
          if (r.kind === 'applied') return { kind: 'applied', deviceSequence: r.deviceSequence };
          if (r.kind === 'rejected')
            return {
              kind: 'rejected',
              deviceSequence: r.deviceSequence,
              reason: r.reason ?? 'Unknown rejection',
            };
          return {
            kind: 'duplicate',
            deviceSequence: r.deviceSequence,
            serverSaid: r.reason ?? 'duplicate',
          };
        },
      ),
    );

    return {
      sent: outbound.length,
      settled: await this.queue.settled(),
      queueRemaining: (await this.queue.pending()).length,
      capWarning: response.capWarning,
    };
  }
}
