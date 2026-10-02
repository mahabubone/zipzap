/**
 * Records every call the fakes receive.
 *
 * This is the part that makes the fakes worth more than canned 200s: a test can assert that
 * the product sent the right phone number, the right template, and — critically — that its
 * webhook signature verifies over the raw body.
 */

export type ProviderName = 'paystation' | 'mimsms' | 'moneybag';

export interface RecordedCall {
  readonly seq: number;
  readonly receivedAt: string;
  readonly provider: ProviderName;
  readonly operation: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  /** Verbatim bytes. Re-serialising the parsed body changes key order and breaks HMAC. */
  readonly rawBody: string;
}

let sequence = 0;
let calls: RecordedCall[] = [];

export function record(input: Omit<RecordedCall, 'seq' | 'receivedAt'>): RecordedCall {
  sequence += 1;
  const call: RecordedCall = {
    ...input,
    seq: sequence,
    receivedAt: new Date().toISOString(),
  };
  calls.push(call);
  return call;
}

export function callsSince(seq: number): RecordedCall[] {
  return calls.filter((call) => call.seq > seq);
}

export function allCalls(): readonly RecordedCall[] {
  return calls;
}

export function reset(): void {
  sequence = 0;
  calls = [];
}

export function cursor(): number {
  return sequence;
}
