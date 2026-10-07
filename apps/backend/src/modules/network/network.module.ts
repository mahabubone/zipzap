import { Module, forwardRef } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { ServiceAreaEntity } from './service-area.entity.ts';
import { NetworkService } from './network.service.ts';
import { ManifestService } from './manifest.service.ts';
import { CoverageController } from './coverage.controller.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';

/**
 * network — coverage, geography, routes, trips, manifests.
 *
 * Cycle with shipment is inherent, not accidental: shipment imports network
 * for serviceability, network imports shipment for the reconciliation read
 * (SHIPMENT_LOOKUP.hasArrived). forwardRef on both edges, matching the
 * shipment <-> tracking precedent. Nobody reads another schema's tables —
 * the lookup contract is the sanctioned seam.
 */
@Module({
  imports: [
    forModule('network', [ServiceAreaEntity]),
    forwardRef(() => ShipmentModule),
    IdentityModule,
  ],
  providers: [NetworkService, ManifestService],
  controllers: [CoverageController],
  exports: [NetworkService, ManifestService],
})
export class NetworkModule {}
