import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { PricingVersionEntity } from './pricing-version.entity.ts';
import { PricingRepository } from './pricing.repository.ts';
import { PricingService } from './pricing.service.ts';
import { PricingController } from './pricing.controller.ts';
import { IdentityModule } from '../identity/identity.module.ts';
// The discount that decides a price comes from `merchant.merchants`. Rule 2: ask, never join.
import { MerchantModule } from '../merchant/merchant.module.ts';

@Module({
  imports: [forModule('pricing', [PricingVersionEntity]), IdentityModule, MerchantModule],
  controllers: [PricingController],
  providers: [PricingRepository, PricingService],
  exports: [PricingService],
})
export class PricingModule {}
