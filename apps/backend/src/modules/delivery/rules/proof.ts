/**
 * Proof-of-delivery rules. Framework-free: no @nestjs, no typeorm, no class-validator.
 *
 * A delivery is a claim; a proof is the evidence for it. Without this, `DELIVERED` is a rider's
 * single tap and the only record is a status change — which is why every competitor in this market
 * can tell a customer their parcel arrived and show them nothing.
 *
 * Three things make a proof worth keeping, and all three are required:
 *
 * 1. **The recipient confirmed.** An OTP the recipient reads out to the rider. A photo alone proves
 *    a camera was pointed at a door; only a code proves somebody inside chose to confirm. This is the
 *    part competitors do not have, and the part a disputes conversation actually turns on.
 * 2. **A photo, with its bytes hashed.** Stored as a digest, never as an assertion that a file exists
 *    somewhere.
 * 3. **Where and when.** Coordinates checked against the globe — a proof at 0,0 is a proof with no
 *    coordinates, and it looks like evidence.
 *
 * The OTP is stored as a HASH and compared in constant time, and it is single-use with a small attempt
 * budget. A stored plaintext code is a code that leaks in a database dump; an unlimited-attempt code is
 * a code an attacker reads off a shoulder. Both are the same mistake: treating the confirmation as a
 * formality rather than as the one thing a stranger cannot fake.
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import {
  ProofCodeAttemptsExhaustedError,
  ProofCodeExpiredError,
  ProofCodeInvalidError,
  ProofLocationImplausibleError,
  ProofNotAvailableError,
  ProofPhotoMissingError,
  ProofPhotoTooLargeError,
} from '../../../common/domain-error.ts';
import type { DeliveryStatus } from './delivery.ts';

/** Four digits: short enough to say across a doorway, long enough with the attempt budget below. */
export const OTP_LENGTH = 4;

/**
 * Five attempts, then the code is dead and the parcel needs a resend.
 *
 * Five is chosen against the 10,000-key space: it makes exhaustive guessing a coin flip the
 * *recipient* controls, because the code dies on the fifth guess whether or not the guesses are
 * sequential. Raising this to make brute force comfortable would defeat the point of having it.
 */
export const MAX_OTP_ATTEMPTS = 5;

/** Ten minutes. A rider standing at a door does not wait longer, and a stale code on a phone is a liability. */
export const OTP_TTL_SECONDS = 600;

/** 2 MB. A phone camera downsized for upload is well under this; a raw 12 MP frame is not. */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Bangladesh, generously bounded — the whole country plus generous sea, to reject null-island and swapped coordinates. */
export const BOUNDING_BOX = {
  minLatitude: 20.0,
  maxLatitude: 26.5,
  minLongitude: 88.0,
  maxLongitude: 93.5,
} as const;

/**
 * The code itself. `randomInt` over the crypto RNG, never `Math.random`, and never a hand-rolled
 * modulo — a modulo of a large int skews the low digits, which is a real weakness in a four-digit
 * space.
 *
 * The generator is injectable so a test can prove the digit alphabet without mocking a module.
 */
export function generateOtp(nextDigit: () => number = () => randomInt(10)): string {
  let code = '';
  for (let i = 0; i < OTP_LENGTH; i += 1) code += String(nextDigit() % 10);
  return code;
}

/** Hashed at rest. A dump of `delivery.delivery_proofs` must not hand an attacker the codes. */
export function hashOtp(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${code}`, 'utf8').digest('hex');
}

export interface OtpCheck {
  readonly codeHash: string;
  readonly salt: string;
  readonly issuedAt: Date;
  readonly attemptsUsed: number;
}

export interface OtpVerdict {
  readonly valid: boolean;
  readonly attemptsUsed: number;
  /** Why it failed, for the rider's screen. Never surfaced to anyone but the device that asked. */
  readonly reason?: 'MISMATCH';
}

/**
 * Whether a code may still be tried at all.
 *
 * Split from the comparison so the attempt budget and the TTL are enforced BEFORE the guess is even
 * checked. Otherwise "five tries" means five wrong tries and a correct sixth guess still lands — which
 * is the exact shape of an unlimited-attempt code.
 */
export function canAttemptOtp(check: OtpCheck, now: Date = new Date()): boolean {
  if (check.attemptsUsed >= MAX_OTP_ATTEMPTS) return false;
  return now.getTime() - check.issuedAt.getTime() <= OTP_TTL_SECONDS * 1000;
}

/**
 * Verify a submitted code in constant time.
 *
 * Throws rather than returning false: each failure is a different instruction to the rider (ask for a
 * new code vs stop guessing vs try again), and one boolean would collapse them. `timingSafeEqual`
 * needs equal-length buffers, so a malformed stored digest is a mismatch rather than a crash.
 */
export function verifyOtp(check: OtpCheck, submitted: string, now: Date = new Date()): OtpVerdict {
  if (check.attemptsUsed >= MAX_OTP_ATTEMPTS) throw new ProofCodeAttemptsExhaustedError();
  if (now.getTime() - check.issuedAt.getTime() > OTP_TTL_SECONDS * 1000) {
    throw new ProofCodeExpiredError();
  }

  const expected = Buffer.from(check.codeHash, 'hex');
  const actual = Buffer.from(hashOtp(submitted.trim(), check.salt), 'hex');
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!matches) throw new ProofCodeInvalidError();

  return { valid: true, attemptsUsed: check.attemptsUsed + 1 };
}

export interface PhotoInput {
  readonly base64: string;
  readonly contentType: string;
  readonly bytes: number;
}

export interface NormalisedPhoto {
  readonly contentType: string;
  readonly byteLength: number;
  readonly sha256: string;
}

/**
 * Check a photo and fingerprint it.
 *
 * The SHA-256 is the point. Once the bytes live in object storage this digest is what proves the file
 * a merchant is shown is the file the rider submitted — without it, "the photo" is a hopeful path.
 */
export function normalisePhoto(
  photo: PhotoInput,
  digest: (bytes: Buffer) => string = (bytes) => createHash('sha256').update(bytes).digest('hex'),
): NormalisedPhoto {
  if (photo.bytes <= 0) throw new ProofPhotoMissingError();
  if (photo.bytes > MAX_PHOTO_BYTES)
    throw new ProofPhotoTooLargeError(photo.bytes, MAX_PHOTO_BYTES);
  if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(photo.contentType)) {
    throw new ProofPhotoMissingError();
  }
  return {
    contentType: photo.contentType,
    byteLength: photo.bytes,
    sha256: digest(Buffer.from(photo.base64, 'base64')),
  };
}

/**
 * Reject coordinates that are null-island, swapped, or simply not Bangladesh.
 *
 * A phone can report 0,0 with a confident fix. Accepting it would anchor a proof in the Indian Ocean,
 * which is worse than no coordinate because it reads as evidence.
 */
export function assertPlausibleLocation(latitude: number, longitude: number): void {
  const { minLatitude, maxLatitude, minLongitude, maxLongitude } = BOUNDING_BOX;
  const latOk = latitude >= minLatitude && latitude <= maxLatitude;
  const lonOk = longitude >= minLongitude && longitude <= maxLongitude;
  if (!latOk || !lonOk) throw new ProofLocationImplausibleError();
}

/** The one rule that makes a proof mean anything: no evidence, no delivery. */
export function assertProofIsComplete(proof: {
  readonly otpVerifiedAt: Date | null;
  readonly photoSha256: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}): void {
  if (!proof.otpVerifiedAt) throw new ProofCodeInvalidError();
  if (!proof.photoSha256) throw new ProofPhotoMissingError();
  if (proof.latitude === null || proof.longitude === null) {
    throw new ProofLocationImplausibleError();
  }
}
/** A proof is captured at a door, and only at a door. */
const PROVABLE_STATUSES: ReadonlySet<DeliveryStatus> = new Set<DeliveryStatus>([
  'OUT_FOR_DELIVERY',
  'ATTEMPTED',
]);

/**
 * Whether a proof can be captured at all, given where the job is.
 *
 * OUT_FOR_DELIVERY and ATTEMPTED are the only two states a rider can physically be holding a
 * parcel's OTP for. CREATED/ASSIGNED/ACCEPTED are before the ride; DELIVERED and FAILED are after
 * the outcome, and a proof offered against either is either a duplicate or a reconstruction.
 *
 * Duplicates are handled by the caller, not here: a job already at DELIVERED may still have a
 * stored proof from the delivery that got it there, and re-reading it is a replay, not a conflict.
 */
export function assertProvable(status: DeliveryStatus): void {
  if (!PROVABLE_STATUSES.has(status)) {
    throw new ProofNotAvailableError(
      `A proof can only be captured while a rider is holding the parcel; this job is ${status}.`,
    );
  }
}
