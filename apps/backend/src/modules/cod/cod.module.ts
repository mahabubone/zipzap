import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { CodRecordEntity } from './cod-record.entity.ts';
import { CodRecordRepository } from './cod-record.repository.ts';
import { CollectCodService } from './collect-cod.service.ts';
import { CollectCodController } from './collect-cod.controller.ts';
import { ListCodRecordsController } from './list-cod-records.controller.ts';
import { ListCodRecordsService } from './list-cod-records.service.ts';
import { ListCodExceptionsController } from './list-cod-exceptions.controller.ts';
import { ListCodExceptionsService } from './list-cod-exceptions.service.ts';
import { ReconcileCodController } from './reconcile-cod.controller.ts';
import { ReconcileCodService } from './reconcile-cod.service.ts';
import { EnsureCodRecordService } from './ensure-cod-record.service.ts';
import { CodLookup, COD_LOOKUP } from './cod.lookup.ts';
import { TrackingModule } from '../tracking/tracking.module.ts';
import { IdentityModule } from '../identity/identity.module.ts';

@Module({
  imports: [forModule('cod', [CodRecordEntity]), TrackingModule, IdentityModule],
  controllers: [
    CollectCodController,
    ReconcileCodController,
    ListCodRecordsController,
    ListCodExceptionsController,
  ],
  providers: [
    CodRecordRepository,
    CollectCodService,
    ListCodRecordsService,
    ListCodExceptionsService,
    ReconcileCodService,
    EnsureCodRecordService,
    { provide: COD_LOOKUP, useClass: CodLookup },
  ],
  exports: [
    CollectCodService,
    ListCodExceptionsService,
    ReconcileCodService,
    EnsureCodRecordService,
    CodRecordRepository,
    COD_LOOKUP,
  ],
})
export class CodModule {}
