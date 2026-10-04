/**
 * Integration: the full money path, against real Postgres.
 *
 * COD collect -> ledger entry -> settlement freeze -> approval -> balance.
 * Every step here is a transaction boundary the unit specs cannot prove: row locks that
 * serialise races, idempotency keys that roll back with the work, and a trigger that rejects
 * history rewrites even from the table owner.
 *
 * Skipped, not failed, when DATABASE_URL is absent.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CollectCodService } from '../../dist/modules/cod/collect-cod.service.js';
import { CodRecordRepository } from '../../dist/modules/cod/cod-record.repository.js';
import { CodRecordEntity } from '../../dist/modules/cod/cod-record.entity.js';
import { FinanceConsumer } from '../../dist/modules/finance/finance-consumer.service.js';
import { CreateSettlementService } from '../../dist/modules/finance/create-settlement.service.js';
import { ApproveSettlementService } from '../../dist/modules/finance/approve-settlement.service.js';
import { InitiateSettlementPaymentService } from '../../dist/modules/finance/initiate-settlement-payment.service.js';
import { ConfirmSettlementPaymentService } from '../../dist/modules/finance/confirm-settlement-payment.service.js';
import { MockPaymentProvider } from '../../dist/modules/finance/provider/mock-payment.provider.js';
import { FinanceRepository } from '../../dist/modules/finance/finance.repository.js';
import { PostLedgerEntryService } from '../../dist/modules/finance/post-ledger-entry.service.js';
import { AppendTrackingEventService } from '../../dist/modules/tracking/append-tracking-event.service.js';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { LedgerEntryEntity } from '../../dist/modules/finance/ledger-entry.entity.js';
import { SettlementEntity } from '../../dist/modules/finance/settlement.entity.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

let codDb: DataSource;
let financeDb: DataSource;
let systemDb: DataSource;
let codRecords: CodRecordRepository;
let collect: CollectCodService;
let financeConsumer: FinanceConsumer;
let postEntry: PostLedgerEntryService;
let createSettlement: CreateSettlementService;
let approveSettlement: ApproveSettlementService;
let initiatePayment: InitiateSettlementPaymentService;
let confirmPayment: ConfirmSettlementPaymentService;
let payments: MockPaymentProvider;
let financeRepo: FinanceRepository;

const MERCHANT = randomUUID();

async function seedCodRecord(shipmentId: string, expectedMinor: number): Promise<string> {
  return codDb.transaction(async (manager) => {
    const saved = await new CodRecordRepository().insert(manager, {
      id: randomUUID(),
      shipmentId,
      merchantId: MERCHANT,
      expectedMinor,
      collectedMinor: null,
      currency: 'BDT',
      status: 'COD_EXPECTED',
      failureNote: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    return saved.id;
  });
}

function codEvent(
  id: string,
  recordId: string,
  shipmentId: string,
  collectedMinor: number,
  merchantId: string = MERCHANT,
) {
  return {
    subject: 'zipzap.cod.collected',
    payload: new TextEncoder().encode(
      JSON.stringify({
        id,
        type: 'CODCollected',
        aggregateType: 'cod',
        aggregateId: recordId,
        occurredAt: new Date().toISOString(),
        data: {
          shipmentId,
          merchantId,
          currency: 'BDT',
          expectedMinor: 125_050,
          collectedMinor,
        },
      }),
    ),
  };
}

before(async () => {
  if (!databaseUrl) return;
  codDb = await connectModuleDataSource('cod', [CodRecordEntity]);
  financeDb = await connectModuleDataSource('finance', [LedgerEntryEntity, SettlementEntity]);
  systemDb = await connectModuleDataSource('system', []);

  codRecords = new CodRecordRepository();
  collect = new CollectCodService(codDb, codRecords, new AppendTrackingEventService());
  financeConsumer = new FinanceConsumer(financeDb);
  financeRepo = new FinanceRepository();
  postEntry = new PostLedgerEntryService(financeDb, financeRepo);
  createSettlement = new CreateSettlementService(financeDb, financeRepo);
  approveSettlement = new ApproveSettlementService(financeDb, financeRepo);
  payments = new MockPaymentProvider();
  initiatePayment = new InitiateSettlementPaymentService(financeDb, financeRepo, payments);
  confirmPayment = new ConfirmSettlementPaymentService(financeDb, financeRepo, payments);
});

after(async () => {
  await codDb?.destroy();
  await financeDb?.destroy();
  await systemDb?.destroy();
});

describeIfDb('money path — collect to settled', () => {
  test('full collect posts exactly one ledger entry via the consumer', async () => {
    const shipmentId = randomUUID();
    const recordId = await seedCodRecord(shipmentId, 125_050);

    const { result } = await collect.execute({
      shipmentId,
      collectedMinor: 125_050,
      idempotencyKey: `collect-${randomUUID()}`,
      actorId: null,
    });
    assert.equal(result.status, 'COD_COLLECTED');
    assert.equal(result.shortfallMinor, 0);

    const outcome = await financeConsumer.handle(
      codEvent(randomUUID(), recordId, shipmentId, 125_050),
    );
    assert.equal(outcome, 'processed');

    const entries = await financeDb.query(
      `SELECT * FROM finance.ledger_entries WHERE reference_id = $1`,
      [recordId],
    );
    assert.equal(entries.length, 1, 'exactly one entry for one collection');
    assert.equal(Number(entries[0].amount_minor), 125_050);
    assert.equal(Number(entries[0].direction), 1);
  });

  test('a concurrent double-collect creates one record state, one entry', async () => {
    const shipmentId = randomUUID();
    const recordId = await seedCodRecord(shipmentId, 125_050);
    const key = `race-${randomUUID()}`;

    const results = await Promise.allSettled([
      collect.execute({ shipmentId, collectedMinor: 125_050, idempotencyKey: key, actorId: null }),
      collect.execute({ shipmentId, collectedMinor: 125_050, idempotencyKey: key, actorId: null }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    assert.ok(fulfilled.length >= 1);

    // Replaying the same event twice converges on one entry.
    const eventId = randomUUID();
    const first = await financeConsumer.handle(codEvent(eventId, recordId, shipmentId, 125_050));
    const second = await financeConsumer.handle(codEvent(eventId, recordId, shipmentId, 125_050));
    assert.equal(first, 'processed');
    assert.equal(second, 'duplicate');

    const entries = await financeDb.query(
      `SELECT * FROM finance.ledger_entries WHERE reference_id = $1`,
      [recordId],
    );
    assert.equal(entries.length, 1, 'the race and the replay converge on one entry');
  });

  test('partial collection settles at the collected amount, shortfall visible', async () => {
    const shipmentId = randomUUID();
    const recordId = await seedCodRecord(shipmentId, 125_050);

    const { result } = await collect.execute({
      shipmentId,
      collectedMinor: 125_000,
      idempotencyKey: `partial-${randomUUID()}`,
      actorId: null,
    });
    assert.equal(result.status, 'PARTIAL_COLLECTION');
    assert.equal(result.shortfallMinor, 50);

    await financeConsumer.handle(codEvent(randomUUID(), recordId, shipmentId, 125_000));
    const entries = await financeDb.query(
      `SELECT * FROM finance.ledger_entries WHERE reference_id = $1`,
      [recordId],
    );
    assert.equal(entries.length, 1);
    assert.equal(Number(entries[0].amount_minor), 125_000, 'settled at collected, not expected');
  });

  test('settlement freeze, approval idempotency, and derived balance', async () => {
    const merchant = randomUUID();
    const s1 = randomUUID();
    const r1 = await codDb.transaction(
      async (manager) =>
        (
          await new CodRecordRepository().insert(manager, {
            id: randomUUID(),
            shipmentId: s1,
            merchantId: merchant,
            expectedMinor: 100_000,
            collectedMinor: null,
            currency: 'BDT',
            status: 'COD_EXPECTED',
            failureNote: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as never)
        ).id,
    );
    await collect.execute({
      shipmentId: s1,
      collectedMinor: 100_000,
      idempotencyKey: `settle-${randomUUID()}`,
      actorId: null,
    });
    await financeConsumer.handle(codEvent(randomUUID(), r1, s1, 100_000, merchant));

    // A debit alongside the credit, so the freeze must net, not just sum.
    await postEntry.execute({
      merchantId: merchant,
      type: 'COD_FEE',
      direction: -1,
      amountMinor: 1_800,
      referenceType: 'COD_RECORD',
      referenceId: r1,
      memo: 'gateway fee',
    });

    const created = await createSettlement.execute({ merchantId: merchant, actorId: null });
    assert.equal(
      created.items.length,
      1,
      'only the COD_COLLECTED entry freezes; the fee is separate',
    );
    assert.equal(created.netMinor, 100_000);

    const approveKey = `approve-${randomUUID()}`;
    const approved1 = await approveSettlement.execute({
      settlementId: created.id,
      approverId: randomUUID(),
      idempotencyKey: approveKey,
    });
    assert.equal(approved1.replayed, false);
    assert.equal(approved1.result.status, 'APPROVED');

    // Same key, same settlement: the recorded decision replays byte-for-byte.
    const approved2 = await approveSettlement.execute({
      settlementId: created.id,
      approverId: randomUUID(),
      idempotencyKey: approveKey,
    });
    assert.equal(approved2.replayed, true);
    assert.deepEqual(approved2.result, approved1.result);

    // A fresh key against an already-approved settlement is not a second approval:
    // the machine rejects APPROVED -> APPROVED.
    await assert.rejects(
      () =>
        approveSettlement.execute({
          settlementId: created.id,
          approverId: randomUUID(),
          idempotencyKey: `approve-${randomUUID()}`,
        }),
      /APPROVED/,
    );

    const balance = await financeDb.transaction(async (manager) =>
      financeRepo.balanceMinor(manager, merchant),
    );
    // 100,000 collected minus the 1,800 fee posted alongside.
    assert.equal(balance, 98_200);
  });

  test('the ledger rejects UPDATE and DELETE even from the owner', async () => {
    const rows = await financeDb.query(`SELECT id FROM finance.ledger_entries LIMIT 1`);
    if (rows.length === 0) return;

    await assert.rejects(
      () =>
        financeDb.query(`UPDATE finance.ledger_entries SET memo = 'x' WHERE id = $1`, [rows[0].id]),
      /append-only/,
    );
    await assert.rejects(
      () => financeDb.query(`DELETE FROM finance.ledger_entries WHERE id = $1`, [rows[0].id]),
      /append-only/,
    );
  });

  test('an approved settlement is immutable: items and net cannot change', async () => {
    const merchant = randomUUID();
    const s1 = randomUUID();
    await codDb.transaction(async (manager) =>
      new CodRecordRepository().insert(manager, {
        id: randomUUID(),
        shipmentId: s1,
        merchantId: merchant,
        expectedMinor: 50_000,
        collectedMinor: null,
        currency: 'BDT',
        status: 'COD_EXPECTED',
        failureNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never),
    );
    const rec = await codDb.query(`SELECT id FROM cod.records WHERE shipment_id = $1`, [s1]);
    await collect.execute({
      shipmentId: s1,
      collectedMinor: 50_000,
      idempotencyKey: `imm-${randomUUID()}`,
      actorId: null,
    });
    await financeConsumer.handle(codEvent(randomUUID(), rec[0].id, s1, 50_000, merchant));
    const created = await createSettlement.execute({ merchantId: merchant, actorId: null });
    await approveSettlement.execute({
      settlementId: created.id,
      approverId: randomUUID(),
      idempotencyKey: `imm-ap-${randomUUID()}`,
    });

    await assert.rejects(
      () =>
        financeDb.query(`UPDATE finance.settlements SET frozen_net_minor = 1 WHERE id = $1`, [
          created.id,
        ]),
      /immutable|transition/i,
    );
    await assert.rejects(
      () => financeDb.query(`DELETE FROM finance.settlements WHERE id = $1`, [created.id]),
      /cannot be deleted|immutable/i,
    );
  });

  test('payout: initiate converges, confirm posts the payout entry and settles', async () => {
    const merchant = randomUUID();
    const s1 = randomUUID();
    await codDb.transaction(async (manager) =>
      new CodRecordRepository().insert(manager, {
        id: randomUUID(),
        shipmentId: s1,
        merchantId: merchant,
        expectedMinor: 125_050,
        collectedMinor: null,
        currency: 'BDT',
        status: 'COD_EXPECTED',
        failureNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never),
    );
    const rec = await codDb.query(`SELECT id FROM cod.records WHERE shipment_id = $1`, [s1]);
    await collect.execute({
      shipmentId: s1,
      collectedMinor: 125_050,
      idempotencyKey: `pay-${randomUUID()}`,
      actorId: null,
    });
    await financeConsumer.handle(codEvent(randomUUID(), rec[0].id, s1, 125_050, merchant));
    const created = await createSettlement.execute({ merchantId: merchant, actorId: null });
    await approveSettlement.execute({
      settlementId: created.id,
      approverId: randomUUID(),
      idempotencyKey: `pay-ap-${randomUUID()}`,
    });

    const initiated = await initiatePayment.execute({
      settlementId: created.id,
      idempotencyKey: `pay-init-${randomUUID()}`,
    });
    assert.equal(initiated.result.status, 'PAYMENT_INITIATED');
    assert.match(initiated.result.paymentReference, /^MOCK\d+$/);

    // Same settlement, fresh key, already initiated: the machine rejects the second run.
    await assert.rejects(
      () =>
        initiatePayment.execute({
          settlementId: created.id,
          idempotencyKey: `pay-init-${randomUUID()}`,
        }),
      /PAYMENT_INITIATED/,
    );

    // Drive the mock to terminal, then confirm: payout entry posts, status settles.
    payments.settle(initiated.result.paymentReference, 'succeeded');
    const confirmed = await confirmPayment.execute({
      settlementId: created.id,
      idempotencyKey: `pay-conf-${randomUUID()}`,
    });
    assert.equal(confirmed.result.status, 'SETTLED');
    assert.equal(confirmed.result.providerStatus, 'succeeded');

    const payout = await financeDb.query(
      `SELECT amount_minor, direction FROM finance.ledger_entries
        WHERE reference_type = 'SETTLEMENT' AND reference_id = $1`,
      [created.id],
    );
    assert.equal(payout.length, 1, 'exactly one payout entry for one settlement');
    assert.equal(Number(payout[0].amount_minor), 125_050);
    assert.equal(Number(payout[0].direction), -1);

    const row = await financeDb.query(
      `SELECT status, payment_reference FROM finance.settlements WHERE id = $1`,
      [created.id],
    );
    assert.equal(row[0].status, 'SETTLED');
    assert.equal(row[0].payment_reference, initiated.result.paymentReference);
  });

  test('failed payout advances nothing and posts no entry', async () => {
    const merchant = randomUUID();
    const s1 = randomUUID();
    await codDb.transaction(async (manager) =>
      new CodRecordRepository().insert(manager, {
        id: randomUUID(),
        shipmentId: s1,
        merchantId: merchant,
        expectedMinor: 50_000,
        collectedMinor: null,
        currency: 'BDT',
        status: 'COD_EXPECTED',
        failureNote: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never),
    );
    const rec = await codDb.query(`SELECT id FROM cod.records WHERE shipment_id = $1`, [s1]);
    await collect.execute({
      shipmentId: s1,
      collectedMinor: 50_000,
      idempotencyKey: `payf-${randomUUID()}`,
      actorId: null,
    });
    await financeConsumer.handle(codEvent(randomUUID(), rec[0].id, s1, 50_000, merchant));
    const created = await createSettlement.execute({ merchantId: merchant, actorId: null });
    await approveSettlement.execute({
      settlementId: created.id,
      approverId: randomUUID(),
      idempotencyKey: `payf-ap-${randomUUID()}`,
    });
    const initiated = await initiatePayment.execute({
      settlementId: created.id,
      idempotencyKey: `payf-init-${randomUUID()}`,
    });

    payments.settle(initiated.result.paymentReference, 'failed');
    const confirmed = await confirmPayment.execute({
      settlementId: created.id,
      idempotencyKey: `payf-conf-${randomUUID()}`,
    });
    assert.equal(confirmed.result.status, 'PAYMENT_INITIATED');
    assert.equal(confirmed.result.providerStatus, 'failed');

    const payout = await financeDb.query(
      `SELECT id FROM finance.ledger_entries
        WHERE reference_type = 'SETTLEMENT' AND reference_id = $1`,
      [created.id],
    );
    assert.equal(payout.length, 0, 'a failed payout posts no entry');
  });
});
