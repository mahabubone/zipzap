import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { ReturnRequestEntity } from './return-request.entity.ts';
import { ReturnRequestRepository } from './return-request.repository.ts';
import { ReturnService } from './return.service.ts';
import { ListReturnsService } from './list-returns.service.ts';
import { ReturnController } from './return.controller.ts';
import { ListReturnsController } from './list-returns.controller.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { CodModule } from '../cod/cod.module.ts';

@Module({
  imports: [forModule('returns', [ReturnRequestEntity]), TrackingModule, IdentityModule, CodModule],
  controllers: [ReturnController, ListReturnsController],
  providers: [ReturnRequestRepository, ReturnService, ListReturnsService],
  exports: [ReturnService],
})
export class ReturnsModule {}
