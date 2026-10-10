import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AnalyticsModule } from './analytics.module.ts';
import { MerchantAnalyticsController } from './merchant-analytics.controller.ts';

/**
 * The same registration check `finance-module.spec.ts` exists for.
 *
 * A controller in the directory but not in the module's `controllers` metadata is a 404, and the
 * `network:read` comment in `common/scopes.ts` tells merchants to come here — so an unregistered
 * endpoint reads as "the product has no merchant analytics" rather than "nobody wired it up".
 */

function controllersOf(module: object): unknown[] {
  return (Reflect.getMetadata('controllers', module) ?? []) as unknown[];
}

describe('AnalyticsModule wiring', () => {
  it('registers the merchant analytics controller', () => {
    expect(controllersOf(AnalyticsModule)).toContain(MerchantAnalyticsController);
  });

  it('maps v1/analytics — the path the network:read scope comment points merchants at', () => {
    expect(Reflect.getMetadata('path', MerchantAnalyticsController)).toBe('v1/analytics');
  });
});
