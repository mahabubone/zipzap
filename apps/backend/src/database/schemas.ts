/**
 * The 19 module schemas, plus `system`. One schema per module — the schema IS the
 * boundary (docs/ADR-0002).
 */

export const MODULE_SCHEMAS = [
  'identity',
  'merchant',
  'customer',
  'shipment',
  'pickup',
  'hub',
  'network',
  'rider',
  'delivery',
  'tracking',
  'pricing',
  'cod',
  'finance',
  'returns',
  'notification',
  'support',
  'warehouse',
  'analytics',
  'dashboard',
  'system',
] as const;

export type ModuleSchema = (typeof MODULE_SCHEMAS)[number];

export function isModuleSchema(value: string): value is ModuleSchema {
  return (MODULE_SCHEMAS as readonly string[]).includes(value);
}
