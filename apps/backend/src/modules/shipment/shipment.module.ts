import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { forModule } from '../../database/module-connection.ts';
import { ShipmentEntity } from './shipment.entity.ts';
import { ShipmentRepository } from './shipment.repository.ts';
import { CreateShipmentService } from './create-shipment.service.ts';
import { ShipmentLookup, SHIPMENT_LOOKUP } from './shipment.lookup.ts';
import { BulkJobEntity, BulkRowEntity } from './bulk.entity.ts';
import { BulkRepository } from './bulk.repository.ts';
import { BulkImportService, BULK_QUEUE } from './bulk-import.service.ts';
import { BulkProcessor } from './bulk.processor.ts';
import { BulkImportController } from './bulk-import.controller.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { PricingModule } from '../pricing/pricing.module.ts';
import { CodModule } from '../cod/cod.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { CreateShipmentController } from './create-shipment.controller.ts';

@Module({
  imports: [
    forModule('shipment', [ShipmentEntity, BulkJobEntity, BulkRowEntity]),
    forwardRef(() => TrackingModule),
    PricingModule,
    CodModule,
    IdentityModule,
    BullModule.registerQueue({ name: BULK_QUEUE }),
  ],
  controllers: [CreateShipmentController, BulkImportController],
  providers: [
    ShipmentRepository,
    CreateShipmentService,
    AppendTrackingEventService,
    { provide: SHIPMENT_LOOKUP, useClass: ShipmentLookup },
    BulkRepository,
    BulkImportService,
    BulkProcessor,
  ],
  exports: [SHIPMENT_LOOKUP],
})
export class ShipmentModule {}
