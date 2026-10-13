/**
 * HubScanService — the hub gestures that move a parcel through the network:
 * inbound → sort → outbound → departed → arrived.
 *
 * Own transaction on the hub connection: advance (qualified `shipment.` SQL,
 * validated by the machine), tracking event (qualified `tracking.` SQL), hub
 * validation (own schema) and one outbox row — atomic, like every other
 * mutation (rule 7). The scan kind comes from the pure table in rules/scan.ts;
 * an unknown kind is a 400-shaped validation failure, a wrong-order scan is
 * the machine's 409 — the two failures are deliberately different.
 *
 * `hubCode` is optional but when given it must exist: a scan that claims a
 * hub nobody has heard of is an audit lie waiting to happen.
 */

import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { ResourceNotFoundError, ValidationFailedError } from '../../common/domain-error.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { ShipmentAdvanceService } from '../shipment/advance-shipment.service.ts';
import { HUB_SCAN_KINDS, isHubScanKind, type HubScanKind } from './rules/scan.ts';
import { HubRepository } from './hub.repository.ts';
import { SHIPMENT_LOOKUP, type ShipmentLookup } from '../shipment/shipment.lookup.ts';

export interface HubScanResult {
  readonly shipmentId: string;
  readonly scan: HubScanKind;
  readonly status: string;
  readonly hubCode: string | null;
}

@Injectable()
export class HubScanService {
  constructor(
    @InjectDataSource('hub') private readonly hubDataSource: DataSource,
    @Inject(ShipmentAdvanceService) private readonly advance: ShipmentAdvanceService,
    @Inject(AppendTrackingEventService) private readonly tracking: AppendTrackingEventService,
    @Inject(HubRepository) private readonly hubs: HubRepository,
    @Inject(SHIPMENT_LOOKUP) private readonly shipments: ShipmentLookup,
  ) {}

  async execute(command: {
    shipmentId: string;
    scan: string;
    hubCode?: string | null;
    actorId?: string | null;
  }): Promise<HubScanResult> {
    if (!isHubScanKind(command.scan)) {
      throw new ValidationFailedError([
        {
          path: 'scan',
          message: `unknown scan "${command.scan}"; expected one of INBOUND, SORT, OUTBOUND, DEPARTED, ARRIVED`,
        },
      ]);
    }
    const kind = command.scan;
    const mapping = HUB_SCAN_KINDS[kind];

    return this.hubDataSource.transaction(async (manager) => {
      const hub = command.hubCode ? await this.hubs.findByCode(manager, command.hubCode) : null;
      if (command.hubCode && !hub) {
        throw new ResourceNotFoundError(`Hub "${command.hubCode}" not found.`);
      }

      // Read through SHIPMENT_LOOKUP, not a qualified SELECT: hub does not own `shipment`, and the
      // boundary checker rejects the read even qualified. Taken before the advance so it is one
      // lookup per scan rather than one per scan plus one per row it rewrites.
      const trackingCode = hub ? await this.shipments.findTrackingCode(command.shipmentId) : null;
      const status = await this.advance.advance(manager, command.shipmentId, mapping.to);
      await this.recordPresence(manager, command, kind, hub, trackingCode);

      if (mapping.eventType) {
        await this.tracking.append(manager, {
          id: randomUUID(),
          shipmentId: command.shipmentId,
          eventType: mapping.eventType,
          occurredAt: new Date(),
          actorType: 'OPERATIONS',
          actorId: command.actorId ?? null,
          metadata: { scan: kind, hubCode: command.hubCode ?? null },
        });
      }

      await appendOutbox(manager, {
        type: 'ShipmentScanned',
        aggregateType: 'shipment',
        aggregateId: command.shipmentId,
        payload: { scan: kind, status, hubCode: command.hubCode ?? null },
      });

      return {
        shipmentId: command.shipmentId,
        scan: kind,
        status,
        hubCode: command.hubCode ?? null,
      };
    });
  }

  /**
   * Keep `hub.parcel_presence` in step with the scan, in the same transaction.
   *
   * DEPARTED removes the row: the parcel is on a van, and "at a hub" should then be false rather
   * than true-until-somebody-remembers. ARRIVED puts it back, at whichever hub is scanning it in.
   *
   * Skipped entirely when the scan named no hub. A scan without a `hubCode` is legal — it is how
   * the integration tests and the flagship story drive the machine — and inventing a hub for it
   * would put parcels at a location nobody chose. The console reads presence, so a hubCode-less
   * scan shows up as a parcel nobody has, which is the honest rendering of "we were not told".
   */
  private async recordPresence(
    manager: EntityManager,
    command: { readonly shipmentId: string; readonly hubCode?: string | null },
    kind: HubScanKind,
    hub: { readonly id: string; readonly code: string } | null,
    trackingCode: string | null,
  ): Promise<void> {
    if (!hub || !trackingCode) return;

    if (kind === 'DEPARTED') {
      await this.hubs.clearPresence(manager, command.shipmentId);
      return;
    }

    await this.hubs.upsertPresence(manager, {
      shipmentId: command.shipmentId,
      hubId: hub.id,
      hubCode: hub.code,
      trackingCode,
      lastScan: kind,
    });
  }
}
