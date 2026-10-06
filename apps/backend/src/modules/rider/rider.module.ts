import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { RiderEntity } from './rider.entity.ts';
import { RiderRepository } from './rider.repository.ts';
import { CommandQueueEntity } from './command-queue.entity.ts';
import { CommandQueueRepository } from './command-queue.repository.ts';
import { AssignRiderService } from './assign-rider.service.ts';
import { RegisterRiderService } from './register-rider.service.ts';
import { RegisterRiderController } from './register-rider.controller.ts';
import { RiderSyncController } from './rider-sync.controller.ts';
import { OfflineSyncService } from './offline-sync.service.ts';
import { RIDER_STATUS_VALIDATOR } from './command-queue.validator.ts';
import { OFFLINE_SYNC_VALIDATORS } from './offline-sync.service.ts';
import { UtilisationService } from './utilisation.service.ts';
import { UtilisationController } from './utilisation.controller.ts';
import { IdentityModule } from '../identity/identity.module.ts';

@Module({
  imports: [forModule('rider', [RiderEntity, CommandQueueEntity]), IdentityModule],
  controllers: [RegisterRiderController, RiderSyncController, UtilisationController],
  providers: [
    RiderRepository,
    AssignRiderService,
    RegisterRiderService,
    CommandQueueRepository,
    OfflineSyncService,
    UtilisationService,
    {
      provide: OFFLINE_SYNC_VALIDATORS,
      useValue: { 'zipzap.rider.command': RIDER_STATUS_VALIDATOR },
    },
  ],
  exports: [AssignRiderService, OfflineSyncService, RiderRepository, UtilisationService],
})
export class RiderModule {}
