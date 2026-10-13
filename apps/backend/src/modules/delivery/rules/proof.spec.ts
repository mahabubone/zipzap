import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  ProofCodeAttemptsExhaustedError,
  ProofCodeExpiredError,
  ProofCodeInvalidError,
  ProofLocationImplausibleError,
  ProofPhotoMissingError,
  ProofPhotoTooLargeError,
} from '../../../common/domain-error.ts';
import {
  MAX_OTP_ATTEMPTS,
  MAX_PHOTO_BYTES,
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  assertPlausibleLocation,
  assertProofIsComplete,
  canAttemptOtp,
  generateOtp,
  hashOtp,
  normalisePhoto,
  verifyOtp,
  type OtpCheck,
} from './proof.ts';

const SALT = 'salt-1234';
const ISSUED = new Date('2026-10-10T08:00:00.000Z');

const check = (over: Partial<OtpCheck> = {}): OtpCheck => ({
  codeHash: hashOtp('1234', SALT),
  salt: SALT,
  issuedAt: ISSUED,
  attemptsUsed: 0,
  ...over,
});

const withinWindow = new Date(ISSUED.getTime() + 60_000);

describe('OTP generation', () => {
  it('is the declared length', () => {
    expect(generateOtp()).toHaveLength(OTP_LENGTH);
  });

  it('draws only from 0-9', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateOtp()).toMatch(/^\d{4}$/);
    }
  });

  it('uses the injected generator rather than the RNG, so the alphabet is testable', () => {
    const digits = [1, 2, 3, 4];
    let i = 0;
    expect(generateOtp(() => digits[i++] ?? 0)).toBe('1234');
  });

  it('wraps a generator that returns out-of-range values instead of emitting a two-digit token', () => {
    expect(generateOtp(() => 17)).toBe('7777');
  });

  it('does not repeat — a constant generator is a degenerate case, not a rule', () => {
    // Documented rather than asserted as a guarantee: with 10,000 keys and 4 digits, collisions are
    // possible and only uniqueness on (job, issued_at) matters. This asserts we do not *always*
    // collide.
    const codes = new Set(Array.from({ length: 50 }, () => generateOtp()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('OTP hashing', () => {
  it('never stores the code in the digest', () => {
    expect(hashOtp('1234', SALT)).not.toContain('1234');
  });

  it('is deterministic for the same code and salt', () => {
    expect(hashOtp('1234', SALT)).toBe(hashOtp('1234', SALT));
  });

  it('differs for the same code under a different salt', () => {
    expect(hashOtp('1234', SALT)).not.toBe(hashOtp('1234', 'other-salt'));
  });

  it('differs for a different code', () => {
    expect(hashOtp('1234', SALT)).not.toBe(hashOtp('1235', SALT));
  });
});

describe('OTP verification', () => {
  it('accepts the right code inside the window', () => {
    expect(verifyOtp(check(), '1234', withinWindow)).toEqual({
      valid: true,
      attemptsUsed: 1,
    });
  });

  it('tolerates surrounding whitespace — a rider types this on a keypad', () => {
    expect(verifyOtp(check(), ' 1234 ', withinWindow).valid).toBe(true);
  });

  it('rejects the wrong code', () => {
    expect(() => verifyOtp(check(), '9999', withinWindow)).toThrow(ProofCodeInvalidError);
  });

  it('rejects a code issued under a different salt, so codes do not cross jobs', () => {
    const issuedElsewhere = check({ codeHash: hashOtp('1234', 'salt-9999') });
    expect(() => verifyOtp(issuedElsewhere, '1234', withinWindow)).toThrow(ProofCodeInvalidError);
  });

  it('rejects a malformed stored digest as a mismatch rather than crashing on buffer length', () => {
    expect(() => verifyOtp(check({ codeHash: 'not-hex' }), '1234', withinWindow)).toThrow(
      ProofCodeInvalidError,
    );
  });

  it('rejects a code past the TTL, and says so distinctly from a wrong code', () => {
    const late = new Date(ISSUED.getTime() + (OTP_TTL_SECONDS + 1) * 1000);
    expect(() => verifyOtp(check(), '1234', late)).toThrow(ProofCodeExpiredError);
  });

  it('accepts a code one second inside the TTL, so the boundary is not off by one', () => {
    const edge = new Date(ISSUED.getTime() + OTP_TTL_SECONDS * 1000);
    expect(verifyOtp(check(), '1234', edge).valid).toBe(true);
  });

  it('refuses once the attempt budget is spent, even with the CORRECT code', () => {
    // This is the assertion that matters: "five tries" must mean five TOTAL tries. A budget checked
    // only on mismatch is an unlimited-attempt code with a counter attached.
    const spent = check({ attemptsUsed: MAX_OTP_ATTEMPTS });
    expect(() => verifyOtp(spent, '1234', withinWindow)).toThrow(ProofCodeAttemptsExhaustedError);
  });

  it('counts the successful attempt too', () => {
    expect(verifyOtp(check({ attemptsUsed: 2 }), '1234', withinWindow).attemptsUsed).toBe(3);
  });
});

describe('canAttemptOtp', () => {
  it('is true inside the window with budget left', () => {
    expect(canAttemptOtp(check(), withinWindow)).toBe(true);
  });

  it('is false when the budget is gone', () => {
    expect(canAttemptOtp(check({ attemptsUsed: MAX_OTP_ATTEMPTS }), withinWindow)).toBe(false);
  });

  it('is false when the code has expired', () => {
    const late = new Date(ISSUED.getTime() + (OTP_TTL_SECONDS + 1) * 1000);
    expect(canAttemptOtp(check(), late)).toBe(false);
  });
});

describe('photo normalisation', () => {
  const jpeg = {
    base64: Buffer.from('not really a jpeg').toString('base64'),
    contentType: 'image/jpeg',
    bytes: 16,
  };

  it('fingerprints the bytes, so the digest identifies this photo and not another', () => {
    const photo = normalisePhoto(jpeg);
    const expected = createHash('sha256').update(Buffer.from(jpeg.base64, 'base64')).digest('hex');
    expect(photo.sha256).toBe(expected);
  });

  it('records the content type and byte length', () => {
    const photo = normalisePhoto(jpeg);
    expect(photo).toMatchObject({ contentType: 'image/jpeg', byteLength: 16 });
  });

  it('accepts png and webp', () => {
    expect(normalisePhoto({ ...jpeg, contentType: 'image/png' }).contentType).toBe('image/png');
    expect(normalisePhoto({ ...jpeg, contentType: 'image/webp' }).contentType).toBe('image/webp');
  });

  it('rejects a zero-byte photo rather than storing an empty file as evidence', () => {
    expect(() => normalisePhoto({ ...jpeg, bytes: 0 })).toThrow(ProofPhotoMissingError);
  });

  it('rejects an unsupported content type — an executable renamed .jpg is not a photo', () => {
    expect(() => normalisePhoto({ ...jpeg, contentType: 'application/x-msdownload' })).toThrow(
      ProofPhotoMissingError,
    );
  });

  it('rejects an oversized photo and names both numbers', () => {
    expect(() => normalisePhoto({ ...jpeg, bytes: MAX_PHOTO_BYTES + 1 })).toThrow(
      ProofPhotoTooLargeError,
    );
  });

  it('accepts a photo exactly at the limit, so the boundary is not off by one', () => {
    expect(normalisePhoto({ ...jpeg, bytes: MAX_PHOTO_BYTES }).byteLength).toBe(MAX_PHOTO_BYTES);
  });
});

describe('location plausibility', () => {
  it('accepts Dhaka', () => {
    expect(() => assertPlausibleLocation(23.8103, 90.4125)).not.toThrow();
  });

  it('accepts the far corners of the bounding box', () => {
    expect(() => assertPlausibleLocation(20.0, 88.0)).not.toThrow();
    expect(() => assertPlausibleLocation(26.5, 93.5)).not.toThrow();
  });

  it('rejects null island — a phone with a confident 0,0 fix', () => {
    expect(() => assertPlausibleLocation(0, 0)).toThrow(ProofLocationImplausibleError);
  });

  it('rejects swapped coordinates, which look plausible in a bounding box', () => {
    // 90.4 lat / 23.8 lon is inside neither axis, but the POINT of the check is that a swap is
    // rejected rather than silently accepted as "somewhere in Bangladesh".
    expect(() => assertPlausibleLocation(90.4125, 23.8103)).toThrow(ProofLocationImplausibleError);
  });

  it('rejects a coordinate outside the country', () => {
    expect(() => assertPlausibleLocation(40.7128, -74.006)).toThrow(ProofLocationImplausibleError);
  });
});

describe('assertProofIsComplete', () => {
  const complete = {
    otpVerifiedAt: new Date(),
    photoSha256: 'abc',
    latitude: 23.81,
    longitude: 90.41,
  };

  it('accepts a proof with all three parts', () => {
    expect(() => assertProofIsComplete(complete)).not.toThrow();
  });

  it('rejects a proof the recipient never confirmed', () => {
    expect(() => assertProofIsComplete({ ...complete, otpVerifiedAt: null })).toThrow(
      ProofCodeInvalidError,
    );
  });

  it('rejects a proof with no photo', () => {
    expect(() => assertProofIsComplete({ ...complete, photoSha256: null })).toThrow(
      ProofPhotoMissingError,
    );
  });

  it('rejects a proof with no coordinates', () => {
    expect(() => assertProofIsComplete({ ...complete, latitude: null })).toThrow(
      ProofLocationImplausibleError,
    );
  });
});
