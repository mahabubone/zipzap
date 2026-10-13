import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { FinanceModule } from './finance.module.ts';
import { CreateSettlementController } from './create-settlement.controller.ts';
import { ApproveSettlementController } from './approve-settlement.controller.ts';
import { ListSettlementsController } from './list-settlements.controller.ts';
import { MerchantBalanceController } from './merchant-balance.controller.ts';
import { SettlementPaymentController } from './settlement-payment.controller.ts';

/**
 * The registration that returned 404 until 2026-10-04: the three controllers
 * existed, but FinanceModule never listed them, so no route was mapped.
 *
 * What this proves: the module's `controllers` metadata names every HTTP
 * surface, and each controller declares the path its live proof exercised.
 * A controller added to the directory but not the module fails here
 * instead of 404ing in production.
 *
 * The count grew past three twice, both times silently: `ListSettlementsController` and then
 * `MerchantBalanceController` were 404s until this file named them. That is the failure mode this
 * test exists for, and it is why it asserts membership rather than a length — a length would pass
 * while a controller sat unregistered behind an equal number of stale assertions.
 */

function controllersOf(module: object): unknown[] {
  return (Reflect.getMetadata('controllers', module) ?? []) as unknown[];
}

function pathOf(controller: object): string {
  return Reflect.getMetadata('path', controller) as string;
}

describe('FinanceModule wiring', () => {
  it('registers the settlement and balance controllers', () => {
    const controllers = controllersOf(FinanceModule);
    expect(controllers).toContain(CreateSettlementController);
    expect(controllers).toContain(ApproveSettlementController);
    expect(controllers).toContain(ListSettlementsController);
    expect(controllers).toContain(MerchantBalanceController);
    expect(controllers).toContain(SettlementPaymentController);
  });

  it('maps the routes the money proof exercised', () => {
    expect(pathOf(CreateSettlementController)).toBe('v1/settlements');
    expect(pathOf(ApproveSettlementController)).toBe('v1/settlements');
    expect(pathOf(ListSettlementsController)).toBe('v1/settlements');
    expect(pathOf(SettlementPaymentController)).toBe('v1/settlements');
    // `v1/finance`, not `v1/merchants`: the balance route takes no merchant id, because the
    // credential supplies it and a path id was the thing that could not be checked.
    expect(pathOf(MerchantBalanceController)).toBe('v1/finance');
  });
});
