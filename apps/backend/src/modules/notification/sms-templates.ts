/**
 * SMS templates: the parcel lifecycle in English and Bangla, versioned.
 *
 * Content lives here, never in code. `{trackingCode}` is the only interpolation
 * — anything richer is a template version bump, not string surgery at send time.
 */

export interface SmsTemplateDef {
  readonly name: string;
  readonly version: number;
  readonly locale: 'en' | 'bn';
  readonly body: string;
}

export const SMS_TEMPLATES: readonly SmsTemplateDef[] = [
  {
    name: 'shipment.created',
    version: 1,
    locale: 'en',
    body: 'ZipZap: order received ({trackingCode}). We will notify you at each step.',
  },
  {
    name: 'shipment.created',
    version: 1,
    locale: 'bn',
    body: 'জিপজ্যাপ: অর্ডার পেয়েছি ({trackingCode})। প্রতিটি ধাপে জানাবো।',
  },
  {
    name: 'shipment.out_for_delivery',
    version: 1,
    locale: 'en',
    body: 'ZipZap: parcel {trackingCode} is out for delivery. Keep {amount} ready.',
  },
  {
    name: 'shipment.out_for_delivery',
    version: 1,
    locale: 'bn',
    body: 'জিপজ্যাপ: পার্সেল {trackingCode} ডেলিভারির পথে। {amount} প্রস্তুত রাখুন।',
  },
  {
    name: 'shipment.delivered',
    version: 1,
    locale: 'en',
    body: 'ZipZap: parcel {trackingCode} delivered. Thank you.',
  },
  {
    name: 'shipment.delivered',
    version: 1,
    locale: 'bn',
    body: 'জিপজ্যাপ: পার্সেল {trackingCode} ডেলিভার হয়েছে। ধন্যবাদ।',
  },
];

export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}
