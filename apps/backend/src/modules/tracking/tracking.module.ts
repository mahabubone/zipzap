import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { TrackingEventEntity } from './infrastructure/entities/tracking-event.entity.ts';
import { PublicTimelineEntity } from './infrastructure/entities/public-timeline.entity.ts';
import { AppendTrackingEventService } from './application/append-tracking-event.service.ts';
import { TrackingConsumer } from './infrastructure/tracking.consumer.ts';
import { PublicTrackingController } from './transport/public-tracking.controller.ts';

@Module({
  imports: [forModule('tracking', [TrackingEventEntity, PublicTimelineEntity])],
  controllers: [PublicTrackingController],
  providers: [AppendTrackingEventService, TrackingConsumer],
  exports: [AppendTrackingEventService, TrackingConsumer],
})
export class TrackingModule {}
