import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { FinanceModule } from './finance.module.ts';
import { CreateSettlementController } from './create-settlement.controller.ts';
import { ApproveSettlementController } from './approve-settlement.controller.ts';
import { BalanceController } from './balance.controller.ts';
import { SettlementPaymentController } from './settlement-payment.controller.ts';

/**
 * The registration that returned 404 until 2026-10-04: the three controllers
 * existed, but FinanceModule never listed them, so no route was mapped.
 *
 * What this proves: the module's `controllers` metadata names exactly the three
 * HTTP surfaces, and each controller declares the path its live proof exercised.
 * A fourth controller added to the directory but not the module fails here
 * instead of 404ing in production.
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
    expect(controllers).toContain(BalanceController);
    expect(controllers).toContain(SettlementPaymentController);
  });

  it('maps the routes the money proof exercised', () => {
    expect(pathOf(CreateSettlementController)).toBe('v1/settlements');
    expect(pathOf(ApproveSettlementController)).toBe('v1/settlements');
    expect(pathOf(BalanceController)).toBe('v1/merchants');
    expect(pathOf(SettlementPaymentController)).toBe('v1/settlements');
  });
});
