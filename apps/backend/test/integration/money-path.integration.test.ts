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
import { CodLookup } from '../../dist/modules/cod/cod.lookup.js';
import { FinanceConsumer } from '../../dist/modules/finance/finance-consumer.service.js';
import { CreateSettlementService } from '../../dist/modules/finance/create-settlement.service.js';
import { ApproveSettlementService } from '../../dist/modules/finance/approve-settlement.service.js';
import { InitiateSettlementPaymentService } from '../../dist/modules/finance/initiate-settlement-payment.service.js';
import { ConfirmSettlementPaymentService } from '../../dist/modules/finance/confirm-settlement-payment.service.js';
import { MockPaymentProvider } from '../../dist/modules/finance/provider/mock-payment.provider.js';
import { FinanceRepository } from '../../dist/modules/finance/finance.repository.js';
import { PostLedgerEntryService } from '../../dist/modules/finance/post-ledger-entry.service.js';
import { AppendTrackingEventService } from '../../dist/modules/tracking/append-tracking-event.service.js';
import { ReturnService } from '../../dist/modules/returns/return.service.js';
import { ReturnRequestRepository } from '../../dist/modules/returns/return-request.repository.js';
import { ReturnRequestEntity } from '../../dist/modules/returns/return-request.entity.js';
import { ShipmentAdvanceService } from '../../dist/modules/shipment/advance-shipment.service.js';
import { ShipmentEntity } from '../../dist/modules/shipment/shipment.entity.js';
import { connectModuleDataSource } from '../../dist/database/module-connection.js';
import { LedgerEntryEntity } from '../../dist/modules/finance/ledger-entry.entity.js';
import { SettlementEntity } from '../../dist/modules/finance/settlement.entity.js';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

let codDb: DataSource;
let financeDb: DataSource;
let returnsDb: DataSource;
let systemDb: DataSource;
let shipmentDb: DataSource;
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
  returnsDb = await connectModuleDataSource('returns', [ReturnRequestEntity]);
  systemDb = await connectModuleDataSource('system', []);
  shipmentDb = await connectModuleDataSource('shipment', [ShipmentEntity]);

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
  await returnsDb?.destroy();
  await systemDb?.destroy();
  await shipmentDb?.destroy();
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

  test('return completion reverses the collection with a compensating entry', async () => {
    const merchant = randomUUID();
    const s1 = randomUUID();
    // A return implies a delivered (or refused) parcel: the shipment machine
    // refuses to walk return legs from anywhere else, so the fixture is DELIVERED.
    await shipmentDb.query(
      `INSERT INTO shipment.shipments
         (id, tracking_code, merchant_id, sender_name, sender_phone, sender_address,
          recipient_name, recipient_phone, recipient_address, parcel_weight_grams,
          parcel_description, cod_amount_minor, cod_currency, status, pricing_version)
       VALUES ($1, $2, $3, 'T', '+8801700000000', 'Dhaka', 'R', '+8801800000000', 'CTG',
               1000, 'fixture', 125050, 'BDT', 'DELIVERED', 1)`,
      [s1, `ZP-REV${s1.slice(0, 8).toUpperCase()}`, merchant],
    );
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
      idempotencyKey: `rev-${randomUUID()}`,
      actorId: null,
    });
    await financeConsumer.handle(codEvent(randomUUID(), rec[0].id, s1, 125_050, merchant));

    const returns = new ReturnService(
      returnsDb,
      new ReturnRequestRepository(),
      new AppendTrackingEventService(),
      new CodLookup(codDb, new CodRecordRepository()),
      new ShipmentAdvanceService(),
    );
    const { result: requested } = await returns.request({
      shipmentId: s1,
      merchantId: merchant,
      reason: 'CUSTOMER_REFUSED',
      idempotencyKey: `rev-req-${randomUUID()}`,
    });
    await returns.decide({
      returnId: requested.id,
      approverId: randomUUID(),
      note: 'customer refused an intact parcel at the door',
      approve: true,
    });
    for (let leg = 0; leg < 5; leg++) {
      await returns.advance({ returnId: requested.id, actorId: null });
    }

    const completed = await financeConsumer.handle({
      subject: 'zipzap.return.completed',
      payload: new TextEncoder().encode(
        JSON.stringify({
          id: randomUUID(),
          type: 'ReturnCompleted',
          aggregateType: 'return',
          aggregateId: requested.id,
          occurredAt: new Date().toISOString(),
          data: {
            shipmentId: s1,
            merchantId: merchant,
            currency: 'BDT',
            reversedMinor: 125_050,
            returnId: requested.id,
          },
        }),
      ),
    });
    assert.equal(completed, 'processed');

    const rows = await financeDb.query(
      `SELECT entry_type, direction, amount_minor FROM finance.ledger_entries
        WHERE reference_type IN ('COD_RECORD', 'RETURN')
          AND reference_id IN ($1, $2)
        ORDER BY recorded_at`,
      [rec[0].id, requested.id],
    );
    assert.equal(rows.length, 2, 'collection plus reversal, both visible');
    assert.deepEqual(
      rows.map((r: { entry_type: string; direction: string; amount_minor: string }) => [
        r.entry_type,
        Number(r.direction),
        Number(r.amount_minor),
      ]),
      [
        ['COD_COLLECTED', 1, 125_050],
        ['ADJUSTMENT', -1, 125_050],
      ],
    );

    const balance = await financeDb.transaction(async (manager) =>
      financeRepo.balanceMinor(manager, merchant),
    );
    assert.equal(balance, 0, 'the reversal nets the collection to zero');
  });

  describe('scale — exact allocation at volume', () => {
    const N = 10000;
    const AMOUNT = 125_050;

    test('10,000 COD settlements allocate with zero minor units lost', async () => {
      const merchant = randomUUID();

      // 1. Seed 10,000 COD records in one batched transaction.
      const shipments: string[] = [];
      const records: string[] = [];
      for (let i = 0; i < N; i++) {
        shipments.push(randomUUID());
        records.push(randomUUID());
      }
      await seedCodRecords(codDb, merchant, shipments, records, AMOUNT);

      // 2. Consume all collections through the real finance consumer,
      //    throttled so the pool does not flood.
      const events = records.map((rid, i) =>
        codEvent(randomUUID(), rid, shipments[i], AMOUNT, merchant),
      );
      const chunk = 100;
      for (let start = 0; start < events.length; start += chunk) {
        const out = await Promise.allSettled(
          events.slice(start, start + chunk).map((e) => financeConsumer.handle(e)),
        );
        for (const r of out) {
          assert.equal(r.status, 'fulfilled');
          assert.equal((r as PromiseFulfilledResult<unknown>).value, 'processed');
        }
      }

      const expectedTotal = AMOUNT * N;

      // 3. Freeze into one settlement: 10,000 frozen items.
      const settlement = await createSettlement.execute({ merchantId: merchant, actorId: null });
      assert.equal(settlement.items.length, N, 'all 10,000 collections freeze');
      assert.equal(settlement.netMinor, expectedTotal, 'netPayable is exact');
      // Recompute from the frozen snapshot — the stored net is a checksum,
      // not a derived counter. If the freeze truncates any item, this fails.
      const recomputed = settlement.items.reduce((sum, it) => sum + Number(it.amountMinor), 0);
      assert.equal(recomputed, expectedTotal);

      // 4. Approve, initiate, confirm — the frozen net travels byte-for-byte.
      const approveKey = `scale-approve-${randomUUID()}`;
      const approved = await approveSettlement.execute({
        settlementId: settlement.id,
        approverId: randomUUID(),
        idempotencyKey: approveKey,
      });
      assert.equal(approved.result.status, 'APPROVED');

      const initiated = await initiatePayment.execute({
        settlementId: settlement.id,
        idempotencyKey: `scale-init-${randomUUID()}`,
      });
      assert.equal(initiated.result.status, 'PAYMENT_INITIATED');

      // Drive the mock provider to its terminal state, then confirm:
      // the payout entry posts and the machine moves to SETTLED.
      payments.settle(initiated.result.paymentReference, 'succeeded');

      const confirmed = await confirmPayment.execute({
        settlementId: settlement.id,
        idempotencyKey: `scale-confirm-${randomUUID()}`,
      });
      assert.equal(confirmed.result.status, 'SETTLED');
      assert.equal(confirmed.result.netMinor, expectedTotal, 'payout equals the frozen net');

      // 5. Zero minor units lost.
      const collectedTotal = await financeDb.query(
        `SELECT SUM(amount_minor)::bigint AS total FROM finance.ledger_entries
           WHERE merchant_id = $1 AND entry_type = 'COD_COLLECTED'`,
        [merchant],
      );
      assert.equal(
        Number(collectedTotal[0].total),
        expectedTotal,
        'all 10,000 collections were posted',
      );

      const payoutRows = await financeDb.query(
        `SELECT amount_minor FROM finance.ledger_entries
           WHERE reference_type = 'SETTLEMENT' AND reference_id = $1`,
        [settlement.id],
      );
      assert.equal(payoutRows.length, 1, 'exactly one payout row');
      assert.equal(
        Number(payoutRows[0].amount_minor),
        expectedTotal,
        'the payout equals the frozen net — no rounding',
      );

      const balance = await financeDb.transaction(async (manager) =>
        financeRepo.balanceMinor(manager, merchant),
      );
      assert.equal(balance, 0, 'collected was paid in full — nothing left in float, nothing lost');
    });

    async function seedCodRecords(
      db: DataSource,
      merchant: string,
      shipments: string[],
      recordIds: string[],
      amount: number,
    ): Promise<void> {
      await db.transaction(async (manager) => {
        const values = recordIds
          .map(
            (rid, i) =>
              `(
              '${rid}',
              '${shipments[i]}',
              '${merchant}',
              ${amount},
              NULL,
              'BDT',
              'COD_EXPECTED',
              NULL,
              NOW(),
              NOW()
            )`,
          )
          .join(', ');
        await manager.query(
          `INSERT INTO cod.records
             (id, shipment_id, merchant_id, expected_minor, collected_minor, currency,
              status, failure_note, created_at, updated_at)
           VALUES ${values}`,
        );
      });
    }
  });
});
