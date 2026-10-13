import { describe, expect, test } from 'vitest';
import { STATUS_STATES, statusState, statusesIn } from '@zipzap/lexicon';
import { TONE_BY_STATE, jobTone } from './status.ts';

/**
 * The rider app's answer to "what colour is this status", in one place.
 *
 * These tests exist because the answer was in three places before, and they disagreed: `OUT_FOR_DELIVERY`
 * rendered brand on the home preview, neutral on the jobs list and brand on the detail screen. A rider
 * scrolling between two screens watched a delivery change colour without anything having happened to it,
 * and `theme.ts` carried a fourth map that nothing imported.
 *
 * What is asserted here is the shape of the answer — one function, total over the vocabulary — rather
 * than a list of statuses, because the list is where it drifted.
 */

describe('jobTone', () => {
  test('maps every class of state the lexicon declares', () => {
    // A seventh class must fail here and in `packages/web-kit`, naming the tone neither kit has chosen,
    // rather than rendering a badge with no colour — which reads as "this job has no state".
    expect(Object.keys(TONE_BY_STATE).sort()).toEqual([...STATUS_STATES].sort());
  });

  test('routes every status the lexicon classifies through that map', () => {
    for (const state of STATUS_STATES) {
      for (const status of statusesIn(state)) {
        expect(jobTone(status), `${status} (${state}) has no tone`).toBe(TONE_BY_STATE[state]);
      }
    }
  });

  test('paints the state the rider is waiting on as brand', () => {
    // The distinction this app exists to make, and the one that was made three times and twice wrong.
    // On this phone the rider *is* the next step for these, which is why they get the one colour the web
    // kit does not have.
    expect(jobTone('OUT_FOR_DELIVERY')).toBe('brand');
    expect(jobTone('ASSIGNED')).toBe('brand');
    expect(jobTone('PICKED_UP')).toBe('brand');
  });

  test('paints a parcel that is going somewhere else as information', () => {
    expect(jobTone('IN_TRANSIT')).toBe('info');
    expect(jobTone('DISPATCHED')).toBe('info');
  });

  test('keeps a retryable failure apart from a permanent one', () => {
    // Both are red-adjacent, but only one of them means the parcel is gone. Training a rider to ignore
    // red is worse than any single wrong colour.
    expect(jobTone('ATTEMPTED')).toBe('warning');
    expect(jobTone('LOST')).toBe('danger');
    expect(jobTone('CANCELLED')).toBe('danger');
  });

  test('says nothing loudly about a status it has never seen', () => {
    expect(jobTone('SOMETHING_NEW')).toBe('neutral');
    expect(statusState('SOMETHING_NEW')).toBe('neutral');
  });

  test('agrees with itself for the same status, every time', () => {
    // The regression shape: two calls, two answers. The old copies were three functions, so this is the
    // closest a unit test can get to "the list screen and the detail screen disagree".
    for (const status of ['OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'ASSIGNED', 'CREATED']) {
      expect(jobTone(status)).toBe(jobTone(status));
    }
  });
});
