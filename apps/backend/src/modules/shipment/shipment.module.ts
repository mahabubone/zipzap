import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { ShipmentEntity } from './infrastructure/entities/shipment.entity.ts';
import { ShipmentRepository } from './infrastructure/shipment.repository.ts';
import { CreateShipmentService } from './application/create-shipment.service.ts';
import { AppendTrackingEventService } from '../tracking/application/append-tracking-event.service.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { CreateShipmentController } from './transport/create-shipment.controller.ts';

@Module({
  imports: [forModule('shipment', [ShipmentEntity]), TrackingModule, IdentityModule],
  controllers: [CreateShipmentController],
  providers: [ShipmentRepository, CreateShipmentService, AppendTrackingEventService],
})
export class ShipmentModule {}
