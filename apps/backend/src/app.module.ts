import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.ts';
import { SystemModule } from './modules/system/outbox.module.ts';
import { IdentityModule } from './modules/identity/identity.module.ts';
import { MerchantModule } from './modules/merchant/merchant.module.ts';
import { ShipmentModule } from './modules/shipment/shipment.module.ts';
import { TrackingModule } from './modules/tracking/tracking.module.ts';
import { PickupModule } from './modules/pickup/pickup.module.ts';
import { RiderModule } from './modules/rider/rider.module.ts';
import { DeliveryModule } from './modules/delivery/delivery.module.ts';
import { PricingModule } from './modules/pricing/pricing.module.ts';
import { CodModule } from './modules/cod/cod.module.ts';
import { FinanceModule } from './modules/finance/finance.module.ts';
import { ReturnsModule } from './modules/returns/returns.module.ts';
import { NotificationModule } from './modules/notification/notification.module.ts';
import { NetworkModule } from './modules/network/network.module.ts';
import { HubModule } from './modules/hub/hub.module.ts';
import { DashboardModule } from './modules/dashboard/dashboard.module.ts';

/**
 * The API process. Every domain module is imported once, here.
 *
 * Note the connections: `merchant`, `shipment`, `pickup`, `rider` and `tracking` each
 * register their own schema-scoped DataSource. `identity` registers none, because it owns no
 * tables. That asymmetry is intentional and is the module boundary doing real work.
 *
 * `dashboard` registers its own empty, schema-scoped DataSource too — it owns no data,
 * it only reads all of it, so the schema boundary is a marker for the aggregation view,
 * not a data store.
 */
@Module({
  imports: [
    SystemModule,
    IdentityModule,
    MerchantModule,
    TrackingModule,
    ShipmentModule,
    PickupModule,
    RiderModule,
    DeliveryModule,
    PricingModule,
    CodModule,
    FinanceModule,
    ReturnsModule,
    NotificationModule,
    NetworkModule,
    HubModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
