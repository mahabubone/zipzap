import { Module } from '@nestjs/common';
import { forModule } from '../../database/module-connection.ts';
import { LedgerEntryEntity } from './ledger-entry.entity.ts';
import { SettlementEntity } from './settlement.entity.ts';
import { FinanceRepository } from './finance.repository.ts';
import { PostLedgerEntryService } from './post-ledger-entry.service.ts';
import { CreateSettlementService } from './create-settlement.service.ts';
import { ApproveSettlementService } from './approve-settlement.service.ts';
import { FinanceConsumer } from './finance-consumer.service.ts';
import { CreateSettlementController } from './create-settlement.controller.ts';
import { ApproveSettlementController } from './approve-settlement.controller.ts';
import { BalanceController } from './balance.controller.ts';
import { IdentityModule } from '../identity/identity.module.ts';

@Module({
  imports: [forModule('finance', [LedgerEntryEntity, SettlementEntity]), IdentityModule],
  controllers: [CreateSettlementController, ApproveSettlementController, BalanceController],
  providers: [
    FinanceRepository,
    PostLedgerEntryService,
    CreateSettlementService,
    ApproveSettlementService,
    FinanceConsumer,
  ],
  exports: [
    PostLedgerEntryService,
    CreateSettlementService,
    ApproveSettlementService,
    FinanceConsumer,
  ],
})
export class FinanceModule {}
