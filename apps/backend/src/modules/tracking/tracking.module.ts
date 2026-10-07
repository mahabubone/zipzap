import { Module, forwardRef } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { TrackingEventEntity } from './tracking-event.entity.ts';
import { PublicTimelineEntity } from './public-timeline.entity.ts';
import { AppendTrackingEventService } from './append-tracking-event.service.ts';
import { TrackingConsumer } from './tracking.consumer.ts';
import { TrackingFanout } from './tracking-fanout.ts';
import { PublicTrackingController } from './public-tracking.controller.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';

@Module({
  // Cycle is inherent, not accidental: shipment writes tracking history through
  // AppendTrackingEventService (shipment -> tracking), while the consumer resolves public codes
  // back through ShipmentLookup (tracking -> shipment). forwardRef on both edges.
  imports: [
    forModule('tracking', [TrackingEventEntity, PublicTimelineEntity]),
    forwardRef(() => ShipmentModule),
  ],
  controllers: [PublicTrackingController],
  providers: [AppendTrackingEventService, TrackingConsumer, TrackingFanout],
  exports: [AppendTrackingEventService, TrackingConsumer, TrackingFanout],
})
export class TrackingModule {}
