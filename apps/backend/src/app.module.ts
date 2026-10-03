import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.ts';
import { SystemModule } from './modules/system/outbox.module.ts';
import { IdentityModule } from './modules/identity/identity.module.ts';
import { MerchantModule } from './modules/merchant/merchant.module.ts';
import { ShipmentModule } from './modules/shipment/shipment.module.ts';
import { TrackingModule } from './modules/tracking/tracking.module.ts';

/**
 * The API process. Every domain module is imported once, here.
 *
 * Note the connections: `merchant`, `shipment` and `tracking` each register their own
 * schema-scoped DataSource. `identity` registers none, because it owns no tables. That asymmetry
 * is intentional and is the module boundary doing real work.
 */
@Module({
  imports: [SystemModule, IdentityModule, MerchantModule, TrackingModule, ShipmentModule],
  controllers: [HealthController],
})
export class AppModule {}
