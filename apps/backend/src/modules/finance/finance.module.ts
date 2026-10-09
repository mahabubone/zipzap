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
import { ListSettlementsController } from './list-settlements.controller.ts';
import { ListSettlementsService } from './list-settlements.service.ts';
import { MerchantBalanceService } from './merchant-balance.service.ts';
import { MerchantBalanceController } from './merchant-balance.controller.ts';
import { GetSettlementService } from './get-settlement.service.ts';
import { GetSettlementController } from './get-settlement.controller.ts';
import { SettlementPaymentController } from './settlement-payment.controller.ts';
import { InitiateSettlementPaymentService } from './initiate-settlement-payment.service.ts';
import { ConfirmSettlementPaymentService } from './confirm-settlement-payment.service.ts';
import { PAYMENT_PROVIDER, defaultPaymentProvider } from './provider/payment-provider.port.ts';
import { IdentityModule } from '../identity/identity.module.ts';
// The freeze needs to know whether this merchant has an unreviewed collection. Rule 2: an
// injected service, never a join on `cod.records`. CodModule exports COD_LOOKUP for exactly this.
import { CodModule } from '../cod/cod.module.ts';

@Module({
  imports: [forModule('finance', [LedgerEntryEntity, SettlementEntity]), IdentityModule, CodModule],
  controllers: [
    CreateSettlementController,
    ApproveSettlementController,
    ListSettlementsController,
    SettlementPaymentController,
    MerchantBalanceController,
    GetSettlementController,
  ],
  providers: [
    FinanceRepository,
    PostLedgerEntryService,
    CreateSettlementService,
    ListSettlementsService,
    MerchantBalanceService,
    GetSettlementService,
    ApproveSettlementService,
    InitiateSettlementPaymentService,
    ConfirmSettlementPaymentService,
    FinanceConsumer,
    // The payout port: mock by default, real rail later. Environments differ in
    // exactly this line — see provider/payment-provider.port.ts.
    { provide: PAYMENT_PROVIDER, useFactory: defaultPaymentProvider },
  ],
  exports: [
    PostLedgerEntryService,
    CreateSettlementService,
    ApproveSettlementService,
    FinanceConsumer,
  ],
})
export class FinanceModule {}
