import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { TrackingEventEntity } from './tracking-event.entity.ts';
import { PublicTimelineEntity } from './public-timeline.entity.ts';
import { AppendTrackingEventService } from './append-tracking-event.service.ts';
import { TrackingConsumer } from './tracking.consumer.ts';
import { PublicTrackingController } from './public-tracking.controller.ts';

@Module({
  imports: [forModule('tracking', [TrackingEventEntity, PublicTimelineEntity])],
  controllers: [PublicTrackingController],
  providers: [AppendTrackingEventService, TrackingConsumer],
  exports: [AppendTrackingEventService, TrackingConsumer],
})
export class TrackingModule {}
