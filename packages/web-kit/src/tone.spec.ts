import { describe, expect, it } from 'vitest';
import { STATUS_STATES, statusesIn } from '@zipzap/lexicon';
import { statusTone, TONE_BY_STATE, type BadgeTone } from './tone.ts';

/**
 * The adapter between "what this state means" and "what this kit's palette calls it".
 *
 * The test that matters is the last one: the six classes have to cover the six tones the web kit
 * actually has. When someone adds a seventh class, this fails and says which tone is missing, rather
 * than the class quietly falling through to a default.
 */

describe('statusTone', () => {
  it('colours by what a person must act on', () => {
    expect(statusTone('DELIVERED')).toBe('success');
    expect(statusTone('LOST')).toBe('danger');
    expect(statusTone('ON_HOLD')).toBe('warning');
    expect(statusTone('CREATED')).toBe('neutral');
  });

  it("treats everything in motion, including the rider's turn, as information", () => {
    // Deliberately the same colour for both. On a merchant's screen "out for delivery" and "in
    // transit" are two rows of a table; the distinction that matters to a rider is not the distinction
    // that matters here, and a fifth colour would be decoration.
    expect(statusTone('IN_TRANSIT')).toBe('info');
    expect(statusTone('OUT_FOR_DELIVERY')).toBe('info');
  });

  it('is unchanged from the map it replaces, so adopting it moves no screenshot', () => {
    // Every tone the old four-set maps produced, asserted against the one that replaced them.
    const before: ReadonlyArray<readonly [string, string]> = [
      ['DELIVERED', 'success'],
      ['COMPLETED', 'success'],
      ['SETTLED', 'success'],
      ['COD_COLLECTED', 'success'],
      ['RETURNED', 'success'],
      ['RECONCILED', 'success'],
      ['CANCELLED', 'danger'],
      ['LOST', 'danger'],
      ['DAMAGED', 'danger'],
      ['DELIVERY_FAILED', 'danger'],
      ['FAILED', 'danger'],
      ['SUSPENDED', 'danger'],
      ['ON_HOLD', 'warning'],
      ['RETRY_SCHEDULED', 'warning'],
      ['EXCEPTION', 'warning'],
      ['RETURN_INITIATED', 'warning'],
      ['CREATED', 'neutral'],
      ['DRAFT', 'neutral'],
      ['IN_TRANSIT', 'info'],
      ['OUT_FOR_DELIVERY', 'info'],
    ];
    for (const [status, tone] of before) {
      expect(statusTone(status), `${status} moved`).toBe(tone);
    }
  });

  it('falls back to neutral for a status it has never seen', () => {
    expect(statusTone('SOMETHING_NEW')).toBe('neutral');
  });

  it('maps every class of state the lexicon declares, and nothing else', () => {
    // The invariant that makes a seventh class a build failure rather than a mystery: when someone adds
    // one to the lexicon, this says which tone the web kit has not chosen, instead of the class falling
    // through to `undefined` and rendering a badge with no colour.
    expect(Object.keys(TONE_BY_STATE).sort()).toEqual([...STATUS_STATES].sort());
    for (const state of STATUS_STATES) {
      expect(ALLOWED_TONES, `no tone for the "${state}" class`).toContain(TONE_BY_STATE[state]);
    }
  });

  it('routes every status the lexicon classifies through that map', () => {
    for (const state of STATUS_STATES) {
      for (const status of statusesIn(state)) {
        expect(statusTone(status), `${status} (${state}) has no tone`).toBe(TONE_BY_STATE[state]);
      }
    }
  });
});

const ALLOWED_TONES: readonly BadgeTone[] = ['success', 'danger', 'warning', 'neutral', 'info'];
