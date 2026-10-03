import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { RiderEntity } from './rider.entity.ts';
import { RiderRepository } from './rider.repository.ts';
import { AssignRiderService } from './assign-rider.service.ts';
import { RegisterRiderService } from './register-rider.service.ts';
import { RegisterRiderController } from './register-rider.controller.ts';
import { IdentityModule } from '../identity/identity.module.ts';

@Module({
  imports: [forModule('rider', [RiderEntity]), IdentityModule],
  controllers: [RegisterRiderController],
  providers: [RiderRepository, AssignRiderService, RegisterRiderService],
  exports: [AssignRiderService],
})
export class RiderModule {}
