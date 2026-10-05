/**
 * MockSmsChannel — the default SMS rail in development.
 *
 * Records sends in memory and answers delivery reports as delivered. No HTTP,
 * no money, no Segments billed. The DLR path is trivially delivered — the
 * carrier-policy logic lives in rules/channel.ts and is tested there, not here.
 */

import type { OutboundSms, SmsReceipt } from '../rules/channel.ts';
import type { SmsChannel } from './mimsms.adapter.ts';

export class MockSmsChannel implements SmsChannel {
  readonly name = 'sms' as const;

  readonly sent: Array<OutboundSms & { trackingId: string }> = [];
  private counter = 0;

  async send(message: OutboundSms): Promise<SmsReceipt> {
    this.counter += 1;
    const trackingId = `MOCK-SMS-${String(this.counter).padStart(6, '0')}`;
    this.sent.push({ ...message, trackingId });
    return { providerReference: trackingId, trackingId, segments: 1 };
  }

  async deliveryReport(trackingId: string): Promise<{
    dlrName: 'Delivered';
    retryPolicy: 0;
    delivered: true;
  }> {
    if (!this.sent.some((s) => s.trackingId === trackingId)) {
      throw new Error(`Unknown tracking id ${trackingId}.`);
    }
    return { dlrName: 'Delivered', retryPolicy: 0, delivered: true };
  }

  reset(): void {
    this.sent.length = 0;
    this.counter = 0;
  }
}
