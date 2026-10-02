/**
 * Fault injection.
 *
 * A fake that always succeeds tests nothing. The failure paths are where the product breaks:
 * the webhook retry ladder, the SMS dead-letter, the payment-callback idempotency check.
 *
 * Rules are matched in insertion order and consumed `times` times, so a test can say
 * "fail the next two SMS sends, then succeed" and get a deterministic outcome.
 */

import type { ProviderName } from './recorder.ts';

export type TrxStatus = 'processing' | 'success' | 'failed' | 'refund';

/** What a scripted rule does when it matches. */
export type Outcome =
  | { readonly kind: 'reject'; readonly statusCode: string; readonly message: string }
  | { readonly kind: 'httpError'; readonly status: number; readonly message?: string }
  | { readonly kind: 'trxStatus'; readonly status: TrxStatus }
  | { readonly kind: 'timeout'; readonly afterMs?: number };

export interface Rule {
  readonly id: number;
  readonly provider: ProviderName;
  /** Omit to match every operation on that provider. */
  readonly operation?: string;
  /** Extra narrowing, for cases where the operation alone is too coarse. */
  readonly where?: (body: Record<string, unknown>) => boolean;
  /** How many matching calls this rule affects. Omit for unlimited. */
  readonly times?: number;
  readonly outcome: Outcome;
  used: number;
}

let rules: Rule[] = [];
let nextRuleId = 1;

export interface ScriptRequest {
  readonly provider: ProviderName;
  readonly operation?: string;
  readonly field?: string;
  readonly fieldEquals?: string;
  readonly times?: number;
  readonly outcome: Outcome;
}

export function script(request: ScriptRequest): Rule {
  const rule: Rule = {
    id: nextRuleId++,
    provider: request.provider,
    operation: request.operation,
    where:
      request.field === undefined
        ? undefined
        : (body) => String(body[request.field!]) === request.fieldEquals,
    times: request.times,
    outcome: request.outcome,
    used: 0,
  };
  rules.push(rule);
  return rule;
}

export function scriptedRules(): readonly Rule[] {
  return rules;
}

export function resetRules(): void {
  rules = [];
  nextRuleId = 1;
}

/** First unexhausted matching rule, or undefined. Consumes one use. */
export function take(
  provider: ProviderName,
  operation: string,
  body: Record<string, unknown>,
): Outcome | undefined {
  const rule = rules.find(
    (candidate) =>
      candidate.provider === provider &&
      (candidate.operation === undefined || candidate.operation === operation) &&
      (candidate.where === undefined || safeMatch(candidate, body)) &&
      (candidate.times === undefined || candidate.used < candidate.times),
  );
  if (!rule) return undefined;
  rule.used += 1;
  return rule.outcome;
}

/** A `where` predicate from a request body must never take the fake down. */
function safeMatch(rule: Rule, body: Record<string, unknown>): boolean {
  try {
    return rule.where!(body);
  } catch {
    return false;
  }
}
