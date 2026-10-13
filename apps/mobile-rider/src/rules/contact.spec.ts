/**
 * The contact rules.
 *
 * These exist to stop the app rendering a live-looking call button that dials nothing. A rider who
 * taps "Call customer", gets a dial tone, and loses money on a rental car will not tap it again —
 * so the honest version of this feature is copy that tells the truth about the state.
 */

import { describe, expect, it } from 'vitest';
import { contactHint, contactLabel, contactStateFor, telHref } from './contact.ts';

describe('contactStateFor', () => {
  it('is ready when the job carries a number', () => {
    expect(contactStateFor({ kind: 'delivery' }, '01711223344', false)).toEqual({
      kind: 'ready',
      phone: '01711223344',
    });
  });

  it('never offers a customer to call for a pickup', () => {
    // A shop handed the parcel over; dialling its recipient at 7am would be wrong.
    expect(contactStateFor({ kind: 'pickup' }, '01711223344', false)).toEqual({
      kind: 'absent',
      reason: 'not-a-delivery',
    });
  });

  it('is absent when the job has no number, and says so', () => {
    expect(contactStateFor({ kind: 'delivery' }, null, false)).toEqual({
      kind: 'absent',
      reason: 'no-number-on-job',
    });
  });

  it('treats whitespace as no number', () => {
    expect(contactStateFor({ kind: 'delivery' }, '   ', false).kind).toBe('absent');
  });

  it('is loading while unknown rather than guessing', () => {
    expect(contactStateFor({ kind: 'delivery' }, undefined, true).kind).toBe('loading');
  });

  it('is absent with no job at all', () => {
    expect(contactStateFor(null, '01711223344', false)).toEqual({
      kind: 'absent',
      reason: 'not-a-delivery',
    });
  });
});

describe('telHref', () => {
  it('builds a tel: href from a bare number', () => {
    expect(telHref({ kind: 'ready', phone: '01711223344' })).toBe('tel:01711223344');
  });

  it('keeps the leading plus of an international number', () => {
    expect(telHref({ kind: 'ready', phone: '+8801711223344' })).toBe('tel:+8801711223344');
  });

  it('strips formatting a rider would not type', () => {
    // A number saved as "+880 1711-223344" must dial, not fail.
    expect(telHref({ kind: 'ready', phone: '+880 1711-223344' })).toBe('tel:+8801711223344');
  });

  it('is null unless there is something to dial', () => {
    // The whole reason this file exists: a tel: href to empty string dials something.
    expect(telHref({ kind: 'absent', reason: 'no-number-on-job' })).toBeNull();
    expect(telHref({ kind: 'ready', phone: '()' })).toBeNull();
  });
});

describe('the copy', () => {
  it('says why it cannot call a pickup customer', () => {
    const state = contactStateFor({ kind: 'pickup' }, null, false);
    expect(contactLabel(state)).toBe('Call customer');
    expect(contactHint(state)).toMatch(/no customer to call/);
  });

  it('says why it cannot call when the job has no number', () => {
    const state = contactStateFor({ kind: 'delivery' }, null, false);
    expect(contactHint(state)).toMatch(/dispatcher/);
  });

  it('says what pressing it will do when it can call', () => {
    const state = contactStateFor({ kind: 'delivery' }, '01711223344', false);
    expect(contactLabel(state)).toBe('Call customer');
    expect(contactHint(state)).toMatch(/phone app/);
  });
});
