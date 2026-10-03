import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { ApiCredentialEntity } from './api-credential.entity.ts';
import { MerchantEntity } from './merchant.entity.ts';
import { FindCredentialService } from './find-credential.service.ts';

@Module({
  imports: [forModule('merchant', [MerchantEntity, ApiCredentialEntity])],
  providers: [FindCredentialService],
  exports: [FindCredentialService],
})
export class MerchantModule {}
