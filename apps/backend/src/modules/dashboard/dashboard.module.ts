/**
 * dashboard — the control-tower read surface (Phase 6).
 *
 * Read-only. It imports every domain module so it can read live counts through each module's
 * own repository contract. It owns no data and declares no datasource — it is a pure
 * aggregation view over the other modules' schema-scoped connections.
 *
 * No joins across schemas happen here: each `counts*` call is one query on one module's
 * connection, and the batch takes all of them at one instant.
 */

import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';
import { PickupModule } from '../pickup/pickup.module.ts';
import { DeliveryModule } from '../delivery/delivery.module.ts';
import { CodModule } from '../cod/cod.module.ts';
import { RiderModule } from '../rider/rider.module.ts';
import { HubModule } from '../hub/hub.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { DashboardService } from './dashboard.service.ts';
import { DashboardController } from './dashboard.controller.ts';
import { ReportService } from './report.service.ts';
import { ReportController } from './report.controller.ts';

@Module({
  imports: [
    AnalyticsModule,
    ShipmentModule,
    PickupModule,
    DeliveryModule,
    CodModule,
    RiderModule,
    HubModule,
    IdentityModule,
  ],
  providers: [DashboardService, ReportService],
  controllers: [DashboardController, ReportController],
  exports: [DashboardService],
})
export class DashboardModule {}
