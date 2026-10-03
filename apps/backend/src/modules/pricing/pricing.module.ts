import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { PricingVersionEntity } from './pricing-version.entity.ts';
import { PricingRepository } from './pricing.repository.ts';
import { PricingService } from './pricing.service.ts';
import { PricingController } from './pricing.controller.ts';
import { IdentityModule } from '../identity/identity.module.ts';

@Module({
  imports: [forModule('pricing', [PricingVersionEntity]), IdentityModule],
  controllers: [PricingController],
  providers: [PricingRepository, PricingService],
  exports: [PricingService],
})
export class PricingModule {}
