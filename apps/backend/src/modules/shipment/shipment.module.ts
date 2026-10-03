import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { ShipmentEntity } from './shipment.entity.ts';
import { ShipmentRepository } from './shipment.repository.ts';
import { CreateShipmentService } from './create-shipment.service.ts';
import { AppendTrackingEventService } from '../tracking/append-tracking-event.service.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { CreateShipmentController } from './create-shipment.controller.ts';

@Module({
  imports: [forModule('shipment', [ShipmentEntity]), TrackingModule, IdentityModule],
  controllers: [CreateShipmentController],
  providers: [ShipmentRepository, CreateShipmentService, AppendTrackingEventService],
})
export class ShipmentModule {}
