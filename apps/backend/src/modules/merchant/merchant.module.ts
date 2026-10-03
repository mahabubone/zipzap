import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { ApiCredentialEntity } from './infrastructure/entities/api-credential.entity.ts';
import { MerchantEntity } from './infrastructure/entities/merchant.entity.ts';
import { FindCredentialService } from './application/find-credential.service.ts';

@Module({
  imports: [forModule('merchant', [MerchantEntity, ApiCredentialEntity])],
  providers: [FindCredentialService],
  exports: [FindCredentialService],
})
export class MerchantModule {}
