import { Module } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
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
import { RIDER_STATUS_VALIDATOR, ShipmentStateValidator } from './command-queue.validator.ts';
import { RecordPositionService } from './record-position.service.ts';
import { RiderPositionController } from './rider-position.controller.ts';
import { OFFLINE_SYNC_VALIDATORS } from './offline-sync.service.ts';
import { UtilisationService } from './utilisation.service.ts';
import { UtilisationController } from './utilisation.controller.ts';
import { IdentityModule } from '../identity/identity.module.ts';
import { ShipmentModule } from '../shipment/shipment.module.ts';
import type { PendingCommandRow } from './command-queue.repository.ts';

@Module({
  // ShipmentModule exports SHIPMENT_LOOKUP, which the delivery validator reads through rather
  // than opening the shipment connection (rule 2).
  imports: [forModule('rider', [RiderEntity, CommandQueueEntity]), IdentityModule, ShipmentModule],
  controllers: [
    RegisterRiderController,
    RiderSyncController,
    RiderPositionController,
    UtilisationController,
  ],
  providers: [
    RiderRepository,
    AssignRiderService,
    RegisterRiderService,
    CommandQueueRepository,
    OfflineSyncService,
    UtilisationService,
    // Needs SHIPMENT_LOOKUP, so it cannot be a `useValue` constant like the rider-status validator.
    ShipmentStateValidator,
    RecordPositionService,
    {
      provide: OFFLINE_SYNC_VALIDATORS,
      inject: [ShipmentStateValidator],
      useFactory: (shipment: ShipmentStateValidator) => ({
        // A command about the rider: "I am offline", "I am on break".
        'zipzap.rider.command': RIDER_STATUS_VALIDATOR,
        // A command about a parcel. This is the one that makes an offline day safe rather than
        // merely deferred — a scan of something cancelled while the phone was in a pocket is
        // rejected with the reason, not applied over a state the rider never observed.
        'zipzap.rider.delivery': (manager: EntityManager, command: PendingCommandRow) =>
          shipment.validate(manager, command),
        // A proof is a claim about a parcel, so it answers to the same question: is the parcel
        // still in the state the rider saw when the phone went dark? A photograph taken at a door
        // for a parcel that has since been returned elsewhere is evidence of the wrong thing.
        'zipzap.rider.proof': (manager: EntityManager, command: PendingCommandRow) =>
          shipment.validate(manager, command),
      }),
    },
  ],
  exports: [AssignRiderService, OfflineSyncService, RiderRepository, UtilisationService],
})
export class RiderModule {}
