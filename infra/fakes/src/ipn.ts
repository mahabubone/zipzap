/**
 * IPN dispatcher — gateway to merchant, with retries.
 *
 * This is the reason the fake exists in this shape. PayStation's own docs state the IPN is
 * retried on any non-2xx and "the same IPN may arrive more than once — always guard against
 * duplicate processing". That makes the receiver's idempotency the part most likely to be
 * wrong, and it is only testable if something actually retries against a failing receiver.
 *
 * Delivery is deliberately boring: a plain fetch loop with a short, configurable ladder so a
 * test finishes in seconds.
 */

export interface IpnAttempt {
  readonly at: string;
  readonly url: string;
  readonly attempt: number;
  readonly outcome: 'delivered' | 'rejected' | 'unreachable';
  readonly status?: number;
  readonly error?: string;
}

export interface IpnDelivery {
  readonly invoiceNumber: string;
  readonly trxId: string;
  readonly url: string;
  readonly body: unknown;
  readonly attempts: IpnAttempt[];
  readonly delivered: boolean;
}

let defaultUrl = '';
/** Short by design. Real retries are the product's job to be tested against, not the fake's. */
let ladderMs = [0, 200, 500, 1000];

let deliveries: IpnDelivery[] = [];

export function configure(url: string, retryLadderMs?: number[]): void {
  defaultUrl = url;
  if (retryLadderMs && retryLadderMs.length > 0) ladderMs = [...retryLadderMs];
}

export function config(): { url: string; retryLadderMs: number[] } {
  return { url: defaultUrl, retryLadderMs: [...ladderMs] };
}

export function allDeliveries(): readonly IpnDelivery[] {
  return deliveries;
}

export function deliveriesFor(trxId: string): IpnDelivery[] {
  return deliveries.filter((delivery) => delivery.trxId === trxId);
}

export function reset(): void {
  deliveries = [];
  ladderMs = [0, 200, 500, 1000];
}

/**
 * Deliver an IPN, retrying on non-2xx. Never throws: a dispatcher that dies takes the
 * checkout page down with it.
 */
export async function deliver(url: string, body: unknown, trxId = ''): Promise<IpnDelivery> {
  const attempts: IpnAttempt[] = [];
  let delivered = false;

  for (const [index, delayMs] of ladderMs.entries()) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      attempts.push({
        at: new Date().toISOString(),
        url,
        attempt: index + 1,
        outcome: response.ok ? 'delivered' : 'rejected',
        status: response.status,
      });
      if (response.ok) {
        delivered = true;
        break;
      }
    } catch (error) {
      attempts.push({
        at: new Date().toISOString(),
        url,
        attempt: index + 1,
        outcome: 'unreachable',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const delivery: IpnDelivery = {
    invoiceNumber: String((body as Record<string, unknown>).invoice_number ?? ''),
    trxId: trxId || String((body as Record<string, unknown>).trx_id ?? ''),
    url,
    body,
    attempts,
    delivered,
  };
  deliveries.push(delivery);
  return delivery;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
