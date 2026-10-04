import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { CodRecordEntity } from './cod-record.entity.ts';
import { CodRecordRepository } from './cod-record.repository.ts';
import { CollectCodService } from './collect-cod.service.ts';
import { CollectCodController } from './collect-cod.controller.ts';
import { ReconcileCodController } from './reconcile-cod.controller.ts';
import { ReconcileCodService } from './reconcile-cod.service.ts';
import { EnsureCodRecordService } from './ensure-cod-record.service.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';

@Module({
  imports: [forModule('cod', [CodRecordEntity]), TrackingModule, IdentityModule],
  controllers: [CollectCodController, ReconcileCodController],
  providers: [CodRecordRepository, CollectCodService, ReconcileCodService, EnsureCodRecordService],
  exports: [CollectCodService, ReconcileCodService, EnsureCodRecordService],
})
export class CodModule {}
