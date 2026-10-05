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
import type { DataSource } from 'typeorm';
import { ResourceNotFoundError, ValidationFailedError } from '../../common/domain-error.ts';
import { append as appendOutbox } from '../system/outbox.writer.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { ShipmentAdvanceService } from '../shipment/advance-shipment.service.ts';
import { HUB_SCAN_KINDS, isHubScanKind, type HubScanKind } from './rules/scan.ts';

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
      if (command.hubCode) {
        const hubs = (await manager.query(`SELECT code FROM hub.hubs WHERE code = $1`, [
          command.hubCode,
        ])) as { code: string }[];
        if (!hubs[0]) {
          throw new ResourceNotFoundError(`Hub "${command.hubCode}" not found.`);
        }
      }

      const status = await this.advance.advance(manager, command.shipmentId, mapping.to);

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
}
