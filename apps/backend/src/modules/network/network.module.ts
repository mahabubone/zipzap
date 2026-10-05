import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { ServiceAreaEntity } from './service-area.entity.ts';
import { NetworkService } from './network.service.ts';

/**
 * network — zones, routes, coverage. Rung 1 ships coverage-as-data plus the
 * serviceability contract; routes/manifests/geo arrive with rung 2.
 *
 * No controllers yet: serviceability is consumed by shipment at creation, not
 * called over HTTP. The schema is its own from migration 0000.
 */
@Module({
  imports: [forModule('network', [ServiceAreaEntity])],
  providers: [NetworkService],
  exports: [NetworkService],
})
export class NetworkModule {}
